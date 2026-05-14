"""Step executor: runs individual test steps, evaluates limits, stores results."""

import hashlib
import hmac
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from config import settings
from drivers.base import InstrumentDriver


def evaluate_limits(measured_value: Optional[float], step: dict) -> str:
    """Compare a measured value against step limits.

    Returns: 'pass', 'fail', 'warning', or 'record_only'.
    """
    if step.get("is_record_only"):
        return "record_only"

    limit_type = step.get("limit_type")
    if limit_type is None or limit_type == "passfail":
        return "record_only"

    if measured_value is None:
        return "skipped"

    if limit_type == "min":
        return "pass" if step.get("limit_min") is not None and measured_value >= step["limit_min"] else "fail"

    if limit_type == "max":
        return "pass" if step.get("limit_max") is not None and measured_value <= step["limit_max"] else "fail"

    if limit_type == "range":
        lmin, lmax = step.get("limit_min"), step.get("limit_max")
        if lmin is not None and lmax is not None and lmin <= measured_value <= lmax:
            return "pass"
        return "fail"

    if limit_type == "nominal":
        nom, tol = step.get("limit_nominal"), step.get("limit_tolerance")
        if nom is not None and tol is not None and abs(measured_value - nom) <= tol:
            return "pass"
        return "fail"

    if limit_type == "exact":
        expected = step.get("bus_data") or step.get("limit_nominal")
        if expected is not None:
            try:
                exp_val = int(expected, 16) if isinstance(expected, str) and expected.startswith("0x") else float(expected)
                if float(measured_value) == exp_val:
                    return "pass"
            except (ValueError, TypeError):
                pass
        return "fail"

    return "record_only"


def compute_integrity_hash(
    run_id: int, step_id: int, measured_value: Optional[float], pass_fail: str, measured_at: str,
) -> str:
    """Compute HMAC-SHA256 integrity hash for a test result."""
    msg = f"{run_id}:{step_id}:{measured_value}:{pass_fail}:{measured_at}"
    return hmac.new(settings.SECRET_KEY.encode(), msg.encode(), hashlib.sha256).hexdigest()


class StepExecutor:
    """Executes a single test step: measure, evaluate, store."""

    async def execute_step(self, run_id: int, step: dict, driver: InstrumentDriver) -> dict:
        step_id = step["id"]
        params = {k: step.get(k) for k in [
            "frequency_mhz", "input_power_dbm", "pulse_width_us",
            "mux_address", "mux_sample_time_us", "bus_address", "bus_data", "bus_rw",
            "limit_type", "limit_min", "limit_max", "limit_nominal", "limit_tolerance",
        ]}

        reading = await driver.measure(step["step_type"], params)
        measured_value = reading.get("value")
        secondary_value = reading.get("secondary_value")
        raw_data = reading.get("raw_data")

        pass_fail = evaluate_limits(measured_value, step)
        measured_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        integrity_hash = compute_integrity_hash(run_id, step_id, measured_value, pass_fail, measured_at)

        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                """INSERT INTO test_results
                   (test_run_id, step_id, measured_value, secondary_value,
                    pass_fail, measured_at, raw_data, integrity_hash)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (run_id, step_id, measured_value, secondary_value, pass_fail, measured_at, raw_data, integrity_hash),
            )
            await db.commit()

        return {
            "step_id": step_id,
            "measured_value": measured_value,
            "secondary_value": secondary_value,
            "pass_fail": pass_fail,
            "measured_at": measured_at,
            "integrity_hash": integrity_hash,
        }
