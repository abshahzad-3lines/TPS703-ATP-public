"""Simulator instrument driver returning realistic values with Gaussian noise."""

import asyncio
import logging
import random
from typing import Optional

from drivers.base import InstrumentDriver

logger = logging.getLogger(__name__)


class SimulatorDriver(InstrumentDriver):
    """Simulates instrument measurements with controlled Gaussian variance."""

    def __init__(self, failure_probability: float = 0.05, seed: Optional[int] = None):
        self._fail_prob = failure_probability
        self._rng = random.Random(seed)
        self._last_command: Optional[str] = None

    async def connect(self) -> None:
        await asyncio.sleep(0.05)
        logger.debug("SimulatorDriver connected")

    async def disconnect(self) -> None:
        await asyncio.sleep(0.02)
        logger.debug("SimulatorDriver disconnected")

    async def identify(self) -> str:
        return "TPS-703 ATP Simulator v1.0"

    async def send(self, command: str) -> None:
        """Simulate sending a SCPI command (write-only).

        Logs the command and stores it for inspection.
        """
        self._last_command = command
        logger.debug("SimulatorDriver send: %s", command)
        await asyncio.sleep(0.01)

    async def query(self, command: str) -> str:
        """Simulate sending a SCPI query and return a mock response.

        Returns realistic mock responses for common IEEE 488.2 and SCPI queries.
        """
        self._last_command = command
        logger.debug("SimulatorDriver query: %s", command)
        await asyncio.sleep(0.01)

        # Standard IEEE 488.2 queries
        if command.strip() == "*IDN?":
            return "TPS-703 ATP Simulator,SIM001,v1.0,0"
        if command.strip() == "*OPC?":
            return "1"
        if command.strip().upper() == "SYST:ERR?":
            return '0,"No error"'

        # Default: return an empty response
        return ""

    async def measure(self, step_type: str, params: dict) -> dict:
        await asyncio.sleep(self._rng.uniform(0.1, 0.4))
        fail = self._rng.random() < self._fail_prob
        handler = getattr(self, f"_sim_{step_type}", None)
        if handler:
            return handler(params, fail)
        return {"value": 0.0, "secondary_value": None, "raw_data": None}

    def _g(self, mu: float, sigma: float) -> float:
        return self._rng.gauss(mu, sigma)

    def _sim_output_power(self, p: dict, fail: bool) -> dict:
        lmin = p.get("limit_min") or 58.6
        c = lmin - 1.5 if fail else lmin + 1.5
        return {"value": round(self._g(c, 0.3), 2), "secondary_value": None, "raw_data": None}

    def _sim_return_loss(self, p: dict, fail: bool) -> dict:
        lmax = p.get("limit_max") or -11.0
        c = lmax + 2.0 if fail else lmax - 3.0
        return {"value": round(self._g(c, 0.5), 2), "secondary_value": None, "raw_data": None}

    def _sim_phase_shift(self, p: dict, fail: bool) -> dict:
        nom = p.get("limit_nominal") or -125.0
        tol = p.get("limit_tolerance") or 20.0
        c = nom + tol + 5.0 if fail else nom
        return {"value": round(self._g(c, 3.0), 2), "secondary_value": None, "raw_data": None}

    def _sim_current(self, p: dict, fail: bool) -> dict:
        lmax = p.get("limit_max") or 9.0
        c = lmax + 0.5 if fail else lmax * 0.85
        return {"value": round(self._g(c, 0.2), 3), "secondary_value": None, "raw_data": None}

    def _sim_spectrum(self, p: dict, fail: bool) -> dict:
        return {"value": round(self._g(-45.0, 3.0), 1), "secondary_value": None, "raw_data": "spectrum_capture"}

    def _sim_bite_signal(self, p: dict, fail: bool) -> dict:
        nom = p.get("limit_nominal")
        if nom is not None:
            c = nom + 2.0 if fail else nom
            return {"value": round(self._g(c, 0.15), 3), "secondary_value": None, "raw_data": None}
        lmax = p.get("limit_max") or 0.5
        c = lmax + 0.3 if fail else lmax * 0.5
        return {"value": round(self._g(c, 0.05), 3), "secondary_value": None, "raw_data": None}

    def _sim_resistance(self, p: dict, fail: bool) -> dict:
        nom = p.get("limit_nominal")
        tol = p.get("limit_tolerance")
        lmax = p.get("limit_max")
        lmin = p.get("limit_min")

        if nom is not None:
            # Nominal +/- tolerance (e.g., 3.15 +/- 0.1 ohms)
            t = tol if tol is not None else 1.0
            c = nom + t + 0.5 if fail else nom
            return {"value": round(self._g(c, t * 0.3), 3), "secondary_value": None, "raw_data": None}

        if lmax is not None and (lmin is None or lmin == 0):
            # Continuity check — max limit, expect near zero (e.g., < 1 ohm)
            c = lmax + 1.0 if fail else lmax * 0.3
            return {"value": round(abs(self._g(c, lmax * 0.15)), 3), "secondary_value": None, "raw_data": None}

        # Fallback
        c = 50.0 if not fail else 55.0
        return {"value": round(self._g(c, 0.1), 3), "secondary_value": None, "raw_data": None}

    def _sim_pulse_width(self, p: dict, fail: bool) -> dict:
        nom = p.get("limit_nominal") or 251.0
        tol = p.get("limit_tolerance") or 5.0
        c = nom + tol + 3.0 if fail else nom
        return {"value": round(self._g(c, 1.0), 2), "secondary_value": None, "raw_data": None}

    def _sim_mux_voltage(self, p: dict, fail: bool) -> dict:
        return {"value": round(self._g(self._rng.uniform(1.0, 5.0), 0.1), 3), "secondary_value": None, "raw_data": None}

    def _sim_bus_write(self, p: dict, fail: bool) -> dict:
        return {"value": 1.0, "secondary_value": None, "raw_data": p.get("bus_data")}

    def _sim_bus_read(self, p: dict, fail: bool) -> dict:
        expected = p.get("bus_data") or "0x0000"
        if fail:
            val = 0xDEAD
        else:
            try:
                val = int(expected, 16) if expected.startswith("0x") else int(expected)
            except (ValueError, AttributeError):
                val = 0
        return {"value": float(val), "secondary_value": None, "raw_data": f"0x{val:04X}"}

    def _sim_fft_peak(self, p: dict, fail: bool) -> dict:
        nom = p.get("limit_nominal") or -4.0
        c = nom + 5.0 if fail else nom
        return {"value": round(self._g(c, 0.5), 2), "secondary_value": None, "raw_data": None}

    def _sim_fft_noise(self, p: dict, fail: bool) -> dict:
        lmax = p.get("limit_max") or -60.0
        c = lmax + 5.0 if fail else -65.0
        return {"value": round(self._g(c, 2.0), 2), "secondary_value": None, "raw_data": None}

    def _sim_fft_sfdr(self, p: dict, fail: bool) -> dict:
        lmin = p.get("limit_min") or 60.0
        c = lmin - 5.0 if fail else 65.0
        return {"value": round(self._g(c, 2.0), 2), "secondary_value": None, "raw_data": None}

    def _sim_sg_setup(self, p: dict, fail: bool) -> dict:
        """Acknowledge a signal-generator setup. Echoes back the requested
        frequency (Hz) and power (dBm); ``raw_data`` is a human-readable
        status string. Always reports success — the simulator does not model
        SG range limits.
        """
        freq_mhz = p.get("frequency_mhz") or 0.0
        pow_dbm = p.get("input_power_dbm") or 0.0
        return {
            "value": float(freq_mhz) * 1e6,
            "secondary_value": float(pow_dbm),
            "raw_data": f"SG: {freq_mhz} MHz, {pow_dbm:+.2f} dBm, RF ON",
        }

    def _sim_input_current(self, p: dict, fail: bool) -> dict:
        lmin, lmax = p.get("limit_min"), p.get("limit_max")
        if lmin is not None and lmax is not None:
            mid = (lmin + lmax) / 2
            span = lmax - lmin
            c = lmax + span * 0.2 if fail else mid
            return {"value": round(self._g(c, span * 0.1), 4), "secondary_value": None, "raw_data": None}
        if lmax is not None:
            c = lmax + 0.3 if fail else lmax * 0.7
            return {"value": round(self._g(c, lmax * 0.05), 4), "secondary_value": None, "raw_data": None}
        return {"value": round(self._g(1.0, 0.1), 4), "secondary_value": None, "raw_data": None}
