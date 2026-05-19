"""Phase 11 — Export S-parameter sweeps to MATLAB / NumPy / CSV.

Each function returns ``(bytes, mime_type, suggested_filename)`` so the
router can wrap it in a ``StreamingResponse``.
"""

from __future__ import annotations

import csv
import io

import numpy as np
import scipy.io
import skrf


def export_mat(ntwk: "skrf.Network", basename: str) -> tuple[bytes, str, str]:
    """MATLAB ``.mat`` v7 with variables: f (Hz), s (n_points × n × n complex)."""
    payload = {
        "f": ntwk.f,
        "s": ntwk.s,
        "z0": ntwk.z0,
        "n_ports": ntwk.nports,
    }
    buf = io.BytesIO()
    scipy.io.savemat(buf, payload, oned_as="column")
    return buf.getvalue(), "application/x-matlab-data", f"{basename}.mat"


def export_npz(ntwk: "skrf.Network", basename: str) -> tuple[bytes, str, str]:
    """NumPy ``.npz`` with arrays: ``f``, ``s``, ``z0``."""
    buf = io.BytesIO()
    np.savez(buf, f=ntwk.f, s=ntwk.s, z0=ntwk.z0)
    return buf.getvalue(), "application/octet-stream", f"{basename}.npz"


def export_csv(ntwk: "skrf.Network", basename: str) -> tuple[bytes, str, str]:
    """CSV with columns: freq_hz, then real/imag per Sij in row-major order."""
    out = io.StringIO()
    w = csv.writer(out)
    headers = ["freq_hz"]
    for i in range(ntwk.nports):
        for j in range(ntwk.nports):
            headers.append(f"S{i+1}{j+1}_re")
            headers.append(f"S{i+1}{j+1}_im")
    w.writerow(headers)
    for n in range(len(ntwk.f)):
        row = [float(ntwk.f[n])]
        for i in range(ntwk.nports):
            for j in range(ntwk.nports):
                c = ntwk.s[n, i, j]
                row.append(float(c.real))
                row.append(float(c.imag))
        w.writerow(row)
    return out.getvalue().encode("utf-8"), "text/csv", f"{basename}.csv"
