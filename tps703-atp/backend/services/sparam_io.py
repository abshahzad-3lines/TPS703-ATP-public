"""Phase 11 — Touchstone v1/v2 read + write.

Backed by ``scikit-rf`` for the heavy lifting (it handles all the
gnarly Touchstone-1.0 / Touchstone-2.0 corner cases). We add:

- A strict, line-precise validator that gives users useful errors
  ("line 14: expected 5 numeric columns for n_ports=2 MA format,
  got 4") instead of a generic ParseError stack trace.
- A canonical v2 writer so what we store in the database is
  deterministic regardless of how the source file was formatted.
- Helpers that convert the in-memory ``skrf.Network`` into the
  visualisation primitives the frontend needs (dB / phase /
  group-delay / Smith / polar).

All functions are sync — Touchstone parsing is pure CPU and the
files are small (~kB to a few MB).
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass

import numpy as np
import skrf


# Format spec from Touchstone documents
_FREQ_UNITS = {"hz": 1.0, "khz": 1e3, "mhz": 1e6, "ghz": 1e9}
_PARAM_TYPES = {"s", "y", "z", "h", "g"}
_DATA_FORMATS = {"ma", "db", "ri"}


class TouchstoneError(ValueError):
    """Raised by ``parse_touchstone`` when the file is malformed.

    Has ``.line`` and ``.column`` (1-based) attributes when known so
    the router can surface them to the UI verbatim.
    """

    def __init__(self, message: str, line: int | None = None, column: int | None = None):
        loc = []
        if line is not None:
            loc.append(f"line {line}")
        if column is not None:
            loc.append(f"col {column}")
        prefix = ", ".join(loc)
        super().__init__(f"{prefix}: {message}" if prefix else message)
        self.line = line
        self.column = column


@dataclass
class TouchstoneHeader:
    freq_unit: str           # 'hz' | 'khz' | 'mhz' | 'ghz'
    param_type: str          # 's' (typical)
    data_format: str         # 'ma' | 'db' | 'ri'
    z0: float                # reference impedance in ohms


def _parse_option_line(line: str, line_no: int) -> TouchstoneHeader:
    """Parse the ``# HZ S MA R 50`` option line."""
    parts = line.split()
    if not parts or parts[0] != "#":
        raise TouchstoneError("option line must start with '#'", line=line_no)

    freq_unit = "ghz"
    param_type = "s"
    data_format = "ma"
    z0 = 50.0

    i = 1
    while i < len(parts):
        tok = parts[i].lower()
        if tok in _FREQ_UNITS:
            freq_unit = tok
        elif tok in _PARAM_TYPES:
            param_type = tok
        elif tok in _DATA_FORMATS:
            data_format = tok
        elif tok == "r":
            i += 1
            if i >= len(parts):
                raise TouchstoneError("'R' must be followed by impedance", line=line_no)
            try:
                z0 = float(parts[i])
            except ValueError:
                raise TouchstoneError(
                    f"expected numeric impedance after 'R', got {parts[i]!r}",
                    line=line_no,
                )
        else:
            raise TouchstoneError(
                f"unknown option-line token {tok!r}",
                line=line_no,
            )
        i += 1
    return TouchstoneHeader(freq_unit, param_type, data_format, z0)


def _detect_n_ports(filename: str, body_lines: list[tuple[int, str]]) -> int:
    """Infer port count from filename extension and verify against the data."""
    m = re.search(r"\.s(\d+)p$", filename or "", re.IGNORECASE)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 8:
            return n

    # Fallback: count numeric columns on the first data line
    if not body_lines:
        raise TouchstoneError("file has no data lines")
    line_no, line = body_lines[0]
    cols = len(line.split())
    # frequency + 2 floats per port-pair (1 port: 1 pair, 2 ports: 4 pairs, ...)
    for n in (1, 2, 3, 4, 5, 6, 7, 8):
        if cols == 1 + 2 * (n * n):
            return n
    raise TouchstoneError(
        f"could not infer port count from data: {cols} columns on first row",
        line=line_no,
    )


def parse_touchstone(text: str, filename: str = "") -> "skrf.Network":
    """Parse a Touchstone v1/v2 string. Returns ``skrf.Network`` on success.

    Raises ``TouchstoneError`` with ``line`` set on any malformed input.
    Validation rules:
    - Exactly one option line ``# ...`` before the data.
    - Every data line has the right column count for the port count.
    - All values numeric.
    - Frequencies strictly increasing.
    """
    # --- Tokenize ----------------------------------------------------------
    lines = text.splitlines()
    if not any(l.strip() for l in lines):
        raise TouchstoneError("file is empty")

    option_line_no: int | None = None
    header: TouchstoneHeader | None = None
    data_lines: list[tuple[int, str]] = []

    for i, raw in enumerate(lines, start=1):
        # Strip comments (anything after !)
        line = raw.split("!", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            # Touchstone v2 keyword lines — let skrf handle them
            continue
        if line.startswith("#"):
            if option_line_no is not None:
                raise TouchstoneError(
                    "multiple option lines found",
                    line=i,
                )
            header = _parse_option_line(line, i)
            option_line_no = i
            continue
        data_lines.append((i, line))

    if header is None:
        raise TouchstoneError("missing option line (starts with '#')")
    if not data_lines:
        raise TouchstoneError("no data rows after option line")

    n_ports = _detect_n_ports(filename, data_lines)
    expected_cols = 1 + 2 * (n_ports * n_ports)

    # --- Validate columns + numeric ----------------------------------------
    prev_freq: float | None = None
    for line_no, line in data_lines:
        toks = line.split()
        if len(toks) != expected_cols:
            raise TouchstoneError(
                f"expected {expected_cols} columns for {n_ports}-port "
                f"({header.data_format.upper()} format), got {len(toks)}",
                line=line_no,
            )
        for col_idx, tok in enumerate(toks, start=1):
            try:
                float(tok)
            except ValueError:
                raise TouchstoneError(
                    f"non-numeric value {tok!r}",
                    line=line_no,
                    column=col_idx,
                )
        freq = float(toks[0])
        if prev_freq is not None and freq <= prev_freq:
            raise TouchstoneError(
                f"frequency must strictly increase: {prev_freq} → {freq}",
                line=line_no,
            )
        prev_freq = freq

    # --- Hand off to skrf for the actual S-matrix construction -------------
    try:
        return skrf.Network(io.StringIO(text), name=filename or "uploaded")
    except Exception as e:  # noqa: BLE001
        raise TouchstoneError(f"scikit-rf parse failure: {e}")


def write_touchstone_v2(ntwk: "skrf.Network") -> str:
    """Render a Network as a deterministic Touchstone v2 string."""
    buf = io.StringIO()
    # skrf 1.12 write_touchstone writes to file; redirect via temp file
    import tempfile
    import os
    fd, tmp = tempfile.mkstemp(suffix=".s2p")
    os.close(fd)
    try:
        ntwk.write_touchstone(tmp, write_z0=False, form="ma", skrf_comment=False)
        with open(tmp, "r") as f:
            return f.read()
    finally:
        try: os.unlink(tmp)
        except OSError: pass


# ---------------------------------------------------------------------------
# Visualisation primitives — what the frontend asks for
# ---------------------------------------------------------------------------


def to_visualisation(ntwk: "skrf.Network") -> dict:
    """Convert a Network into JSON-friendly arrays for the frontend.

    Returns ``{freq_hz, mag_db, phase_deg, real, imag, group_delay_s,
    smith_real, smith_imag, n_ports, n_points}``. Each S-parameter
    (``s11``, ``s21``, ...) gets its own sub-dict.
    """
    s = ntwk.s  # shape (n_points, n_ports, n_ports), complex
    n_points, n_ports, _ = s.shape
    freq = ntwk.f.tolist()

    out: dict = {
        "n_ports": n_ports,
        "n_points": n_points,
        "f_start_hz": float(ntwk.f[0]),
        "f_stop_hz": float(ntwk.f[-1]),
        "z0_ohm": float(np.real(ntwk.z0[0, 0])),
        "freq_hz": freq,
        "params": {},
    }

    for i in range(n_ports):
        for j in range(n_ports):
            sij = s[:, i, j]
            mag = np.abs(sij)
            # Avoid log10(0) — clip to a very small floor
            mag_db = 20.0 * np.log10(np.maximum(mag, 1e-12))
            phase_deg = np.degrees(np.angle(sij))
            phase_unwrapped = np.degrees(np.unwrap(np.angle(sij)))

            # Group delay = -dφ/dω, with φ in radians and ω in rad/s
            if n_points >= 2:
                omega = 2.0 * np.pi * ntwk.f
                # Central differences for interior, one-sided at edges
                gd = -np.gradient(np.unwrap(np.angle(sij)), omega)
            else:
                gd = np.zeros_like(mag)

            key = f"s{i+1}{j+1}"
            out["params"][key] = {
                "mag_db": mag_db.tolist(),
                "phase_deg": phase_deg.tolist(),
                "phase_unwrapped_deg": phase_unwrapped.tolist(),
                "real": np.real(sij).tolist(),
                "imag": np.imag(sij).tolist(),
                "group_delay_s": gd.tolist(),
            }
    return out


# ---------------------------------------------------------------------------
# Header summary (cheap — used in list views)
# ---------------------------------------------------------------------------


def summarize(ntwk: "skrf.Network") -> dict:
    return {
        "n_ports": int(ntwk.nports),
        "n_points": int(len(ntwk.f)),
        "f_start_hz": float(ntwk.f[0]),
        "f_stop_hz": float(ntwk.f[-1]),
        "z0_ohm": float(np.real(ntwk.z0[0, 0])),
    }
