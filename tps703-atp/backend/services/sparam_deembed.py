"""Phase 11 — Fixture de-embedding.

OSLT (Open/Short/Load/Thru) is the canonical 2-port VNA cal. We don't
re-implement the math here — scikit-rf's ``SOLT`` calibration handles
it. We just expose a high-level "given these four sweeps + a raw DUT
sweep, return the de-embedded DUT sweep" helper.

The 1-port flavour (just Open/Short/Load, no Thru) is also supported
via ``OnePort`` calibration.
"""

from __future__ import annotations

from typing import Iterable

import skrf
from skrf.calibration import OnePort, SOLT


def deembed(
    raw_dut: "skrf.Network",
    *,
    cal_type: str = "OSLT",
    open_sweep: "skrf.Network",
    short_sweep: "skrf.Network",
    load_sweep: "skrf.Network",
    thru_sweep: "skrf.Network | None" = None,
) -> "skrf.Network":
    """Return the calibrated (de-embedded) DUT network.

    Raises ``ValueError`` for any incompatible cal sweep.
    """
    n_ports = raw_dut.nports

    if n_ports == 1:
        # 1-port OSL: only need open/short/load
        ideal_open = _ideal_open(raw_dut.frequency)
        ideal_short = _ideal_short(raw_dut.frequency)
        ideal_load = _ideal_load(raw_dut.frequency)
        cal = OnePort(
            measured=[open_sweep, short_sweep, load_sweep],
            ideals=[ideal_open, ideal_short, ideal_load],
        )
        cal.run()
        return cal.apply_cal(raw_dut)

    if n_ports == 2:
        if cal_type.upper() in {"OSLT", "SOLT"}:
            if thru_sweep is None:
                raise ValueError("2-port SOLT requires a thru sweep")
            ideals = _solt_ideals(raw_dut.frequency)
            cal = SOLT(
                measured=[short_sweep, open_sweep, load_sweep, thru_sweep],
                ideals=ideals,
            )
            cal.run()
            return cal.apply_cal(raw_dut)
        raise ValueError(f"unsupported 2-port cal type: {cal_type}")

    raise ValueError(f"de-embed only supports 1-port and 2-port for now (got {n_ports})")


# ---------------------------------------------------------------------------
# Ideal standards — flat models, fine for typical lab cal kits at S-band.
# Production-grade work would substitute polynomial models from the kit
# datasheet. ``frequency`` is an ``skrf.Frequency`` object.
# ---------------------------------------------------------------------------


def _ideal_open(freq: "skrf.Frequency") -> "skrf.Network":
    """Ideal open: S11 = +1 across the band."""
    media = skrf.media.DefinedGammaZ0(frequency=freq, z0=50)
    return media.open()


def _ideal_short(freq: "skrf.Frequency") -> "skrf.Network":
    media = skrf.media.DefinedGammaZ0(frequency=freq, z0=50)
    return media.short()


def _ideal_load(freq: "skrf.Frequency") -> "skrf.Network":
    media = skrf.media.DefinedGammaZ0(frequency=freq, z0=50)
    return media.match()


def _solt_ideals(freq: "skrf.Frequency") -> list["skrf.Network"]:
    """Returns [short, open, load, thru] — scikit-rf SOLT canonical order."""
    media = skrf.media.DefinedGammaZ0(frequency=freq, z0=50)
    return [
        skrf.two_port_reflect(media.short(), media.short()),
        skrf.two_port_reflect(media.open(), media.open()),
        skrf.two_port_reflect(media.match(), media.match()),
        media.thru(),
    ]
