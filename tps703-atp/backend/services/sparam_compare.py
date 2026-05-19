"""Phase 11 — Golden-unit comparison + pass/fail mask evaluation.

A mask is a list of ``{f_start, f_stop, param, quantity, min, max}``
bands. The comparison engine interpolates the sweep onto the mask's
band midpoints and reports any band where the measured quantity falls
outside the [min, max] window.

Golden-unit overlay is just a side-by-side sweep returned as JSON; the
frontend does the actual chart rendering.
"""

from __future__ import annotations

import json

import numpy as np
import skrf

from services import sparam_io


def evaluate_mask(ntwk: "skrf.Network", mask_bands: list[dict]) -> dict:
    """Return ``{passed, failures: [...]}`` for the network against the bands.

    Each ``mask_bands`` entry: ``{f_start_hz, f_stop_hz, param, quantity,
    min, max}``. ``quantity`` ∈ {mag_db, mag_linear, phase_deg, vswr,
    return_loss_db}.

    A failure entry describes the worst excursion in that band.
    """
    freq = np.asarray(ntwk.f)
    failures: list[dict] = []
    band_results: list[dict] = []

    for band_idx, band in enumerate(mask_bands):
        try:
            param = (band["param"] or "s21").lower()
            quantity = band["quantity"]
            f_lo = float(band["f_start_hz"])
            f_hi = float(band["f_stop_hz"])
        except (KeyError, TypeError, ValueError) as e:
            failures.append({
                "band_index": band_idx,
                "reason": f"bad band: {e}",
            })
            continue

        mask_idx = (freq >= f_lo) & (freq <= f_hi)
        if not mask_idx.any():
            band_results.append({
                "band_index": band_idx,
                "status": "skipped",
                "reason": "no sweep points in band",
            })
            continue

        i, j = _resolve_port(param)
        s = ntwk.s[mask_idx, i, j]
        vals = _quantity(quantity, s)

        lo = band.get("min")
        hi = band.get("max")
        worst_idx = int(np.argmin(_within(vals, lo, hi)))
        worst = float(vals[worst_idx])
        worst_freq = float(freq[mask_idx][worst_idx])

        bad = (
            (lo is not None and worst < float(lo)) or
            (hi is not None and worst > float(hi))
        )
        result = {
            "band_index": band_idx,
            "param": param, "quantity": quantity,
            "f_start_hz": f_lo, "f_stop_hz": f_hi,
            "min": lo, "max": hi,
            "worst_value": worst,
            "worst_freq_hz": worst_freq,
            "status": "fail" if bad else "pass",
        }
        band_results.append(result)
        if bad:
            failures.append(result)

    return {
        "passed": not failures,
        "band_count": len(mask_bands),
        "failed_count": len(failures),
        "bands": band_results,
        "failures": failures,
    }


def _resolve_port(param: str) -> tuple[int, int]:
    """``'s21'`` → (1, 0). Returns 0-based (out, in) indices for ntwk.s."""
    if len(param) != 3 or param[0] != "s":
        raise ValueError(f"unsupported param {param!r}")
    try:
        out_port = int(param[1])
        in_port = int(param[2])
    except ValueError:
        raise ValueError(f"non-numeric port in {param!r}")
    return out_port - 1, in_port - 1


def _quantity(name: str, s: np.ndarray) -> np.ndarray:
    """Convert an S-parameter complex array to the requested scalar."""
    mag = np.abs(s)
    if name == "mag_db":
        return 20.0 * np.log10(np.maximum(mag, 1e-12))
    if name == "mag_linear":
        return mag
    if name == "phase_deg":
        return np.degrees(np.angle(s))
    if name == "vswr":
        # VSWR only makes sense for reflection terms (|s| < 1)
        m = np.minimum(mag, 0.9999)
        return (1.0 + m) / (1.0 - m)
    if name == "return_loss_db":
        return -20.0 * np.log10(np.maximum(mag, 1e-12))
    raise ValueError(f"unknown quantity {name!r}")


def _within(vals: np.ndarray, lo: float | None, hi: float | None) -> np.ndarray:
    """Returns positive numbers where the value is inside the window and
    negative numbers where it's outside (more negative = worse). Used
    purely to find the argmin (= worst point) cheaply.
    """
    score = np.full_like(vals, np.inf, dtype=float)
    if lo is not None:
        score = np.minimum(score, vals - float(lo))
    if hi is not None:
        score = np.minimum(score, float(hi) - vals)
    return score


# ---------------------------------------------------------------------------
# Golden-unit overlay
# ---------------------------------------------------------------------------


def overlay(
    measured: "skrf.Network",
    golden: "skrf.Network",
) -> dict:
    """Return a structure the frontend can chart directly.

    The two networks may have different frequency grids; we return both
    grids verbatim so the chart can plot them as two traces. We also
    return per-parameter delta arrays (measured - golden, interpolated
    onto the measured grid) so the UI can render a "diff" panel.
    """
    meas_viz = sparam_io.to_visualisation(measured)
    gold_viz = sparam_io.to_visualisation(golden)

    if measured.nports != golden.nports:
        deltas = None
    else:
        deltas = {}
        # Interpolate golden onto measured.f grid for the delta math
        try:
            gold_on_meas = golden.interpolate(measured.frequency)
        except Exception:  # noqa: BLE001
            gold_on_meas = None
        if gold_on_meas is not None:
            for i in range(measured.nports):
                for j in range(measured.nports):
                    key = f"s{i+1}{j+1}"
                    m = measured.s[:, i, j]
                    g = gold_on_meas.s[:, i, j]
                    deltas[key] = {
                        "mag_db": (20.0 * np.log10(np.maximum(np.abs(m), 1e-12))
                                  - 20.0 * np.log10(np.maximum(np.abs(g), 1e-12))).tolist(),
                        "phase_deg": (np.degrees(np.angle(m))
                                      - np.degrees(np.angle(g))).tolist(),
                    }
    return {
        "measured": meas_viz,
        "golden": gold_viz,
        "deltas": deltas,
    }
