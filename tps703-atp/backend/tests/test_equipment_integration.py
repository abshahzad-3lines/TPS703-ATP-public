"""End-to-end equipment integration tests for the TPS-703 ATP system.

Tests the entire test execution pipeline using the SimulatorDriver:
  - Driver lifecycle (connect / disconnect / identify)
  - All simulator measurement types
  - Failure-rate control
  - Limit evaluation logic
  - Integrity hashing
  - Driver factory
  - Full execution pipeline from run creation to completion

Run with:
    cd tps703-atp/backend
    python -m pytest tests/ -v

Or directly:
    python tests/test_equipment_integration.py
"""

import asyncio
import os
import sys

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Path setup — ensure bare imports resolve when running from backend/
# ---------------------------------------------------------------------------
_backend_dir = os.path.join(os.path.dirname(__file__), os.pardir)
sys.path.insert(0, os.path.abspath(_backend_dir))


# ===================================================================
# 1. SimulatorDriver lifecycle
# ===================================================================


@pytest.mark.asyncio
async def test_simulator_driver_lifecycle():
    """Test connect / disconnect / identify on SimulatorDriver."""
    from drivers.simulator import SimulatorDriver

    driver = SimulatorDriver(seed=42)

    # connect should complete without error
    await driver.connect()

    # identify should return the expected string
    ident = await driver.identify()
    assert ident == "TPS-703 ATP Simulator v1.0"

    # disconnect should complete without error
    await driver.disconnect()


# ===================================================================
# 2. All simulator measurement types
# ===================================================================

MEASUREMENT_TYPES = [
    "output_power",
    "return_loss",
    "phase_shift",
    "current",
    "spectrum",
    "bite_signal",
    "resistance",
    "pulse_width",
    "mux_voltage",
    "bus_write",
    "bus_read",
    "fft_peak",
    "fft_noise",
    "fft_sfdr",
    "input_current",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("step_type", MEASUREMENT_TYPES)
async def test_simulator_measurements(step_type: str):
    """Each simulator measurement type must return a dict with a 'value' key."""
    from drivers.simulator import SimulatorDriver

    driver = SimulatorDriver(seed=99, failure_probability=0.0)
    await driver.connect()

    params = {
        "limit_min": 50.0,
        "limit_max": 100.0,
        "limit_nominal": 75.0,
        "limit_tolerance": 10.0,
        "bus_data": "0x1234",
        "bus_address": "0x00",
    }

    result = await driver.measure(step_type, params)

    assert isinstance(result, dict), f"{step_type} did not return a dict"
    assert "value" in result, f"{step_type} result missing 'value' key"
    assert result["value"] is not None, f"{step_type} value is None"

    await driver.disconnect()


# ===================================================================
# 3. Failure-rate control
# ===================================================================


@pytest.mark.asyncio
async def test_simulator_failure_rate_zero():
    """With failure_probability=0.0, all measurements should pass their limits."""
    from drivers.simulator import SimulatorDriver

    driver = SimulatorDriver(seed=1, failure_probability=0.0)
    await driver.connect()

    params = {"limit_min": 50.0}

    for _ in range(1000):
        result = await driver.measure("output_power", params)
        # When failure_probability=0.0, the simulator centres the value
        # above limit_min (lmin + 1.5 ± 0.3 sigma), so value should be >= limit_min.
        assert result["value"] >= params["limit_min"], (
            f"Expected value >= {params['limit_min']}, got {result['value']}"
        )

    await driver.disconnect()


@pytest.mark.asyncio
async def test_simulator_failure_rate_one():
    """With failure_probability=1.0, all measurements should fail their limits."""
    from drivers.simulator import SimulatorDriver

    driver = SimulatorDriver(seed=2, failure_probability=1.0)
    await driver.connect()

    params = {"limit_min": 58.6}

    fail_count = 0
    for _ in range(1000):
        result = await driver.measure("output_power", params)
        # When fail=True, centre is lmin - 1.5 (well below limit).
        # With sigma=0.3 the vast majority will be below limit_min.
        if result["value"] < params["limit_min"]:
            fail_count += 1

    await driver.disconnect()

    # Allow a small tolerance for extreme Gaussian tails — at least 990/1000
    assert fail_count >= 990, (
        f"Expected nearly all to fail; only {fail_count}/1000 were below limit"
    )


# ===================================================================
# 4. evaluate_limits — all limit types + edge cases
# ===================================================================


class TestEvaluateLimits:
    """Test the evaluate_limits() function from step_executor."""

    @staticmethod
    def _eval(value, **step_kwargs):
        from services.step_executor import evaluate_limits
        return evaluate_limits(value, step_kwargs)

    # --- record_only ---
    def test_record_only(self):
        assert self._eval(42.0, is_record_only=True) == "record_only"

    def test_no_limit_type(self):
        assert self._eval(42.0, limit_type=None) == "record_only"

    def test_passfail_limit_type(self):
        assert self._eval(42.0, limit_type="passfail") == "record_only"

    # --- None measured value ---
    def test_none_value(self):
        assert self._eval(None, limit_type="min", limit_min=10.0) == "skipped"

    # --- min ---
    def test_min_pass(self):
        assert self._eval(60.0, limit_type="min", limit_min=50.0) == "pass"

    def test_min_exact(self):
        assert self._eval(50.0, limit_type="min", limit_min=50.0) == "pass"

    def test_min_fail(self):
        assert self._eval(49.9, limit_type="min", limit_min=50.0) == "fail"

    def test_min_missing_limit(self):
        assert self._eval(60.0, limit_type="min") == "fail"

    # --- max ---
    def test_max_pass(self):
        assert self._eval(5.0, limit_type="max", limit_max=10.0) == "pass"

    def test_max_exact(self):
        assert self._eval(10.0, limit_type="max", limit_max=10.0) == "pass"

    def test_max_fail(self):
        assert self._eval(10.1, limit_type="max", limit_max=10.0) == "fail"

    def test_max_missing_limit(self):
        assert self._eval(1.0, limit_type="max") == "fail"

    # --- range ---
    def test_range_pass(self):
        assert self._eval(75.0, limit_type="range", limit_min=50.0, limit_max=100.0) == "pass"

    def test_range_at_min(self):
        assert self._eval(50.0, limit_type="range", limit_min=50.0, limit_max=100.0) == "pass"

    def test_range_at_max(self):
        assert self._eval(100.0, limit_type="range", limit_min=50.0, limit_max=100.0) == "pass"

    def test_range_below(self):
        assert self._eval(49.0, limit_type="range", limit_min=50.0, limit_max=100.0) == "fail"

    def test_range_above(self):
        assert self._eval(101.0, limit_type="range", limit_min=50.0, limit_max=100.0) == "fail"

    def test_range_missing_limits(self):
        assert self._eval(75.0, limit_type="range") == "fail"

    # --- nominal ---
    def test_nominal_pass(self):
        assert self._eval(50.5, limit_type="nominal", limit_nominal=50.0, limit_tolerance=1.0) == "pass"

    def test_nominal_at_edge(self):
        assert self._eval(51.0, limit_type="nominal", limit_nominal=50.0, limit_tolerance=1.0) == "pass"

    def test_nominal_fail(self):
        assert self._eval(52.0, limit_type="nominal", limit_nominal=50.0, limit_tolerance=1.0) == "fail"

    def test_nominal_missing(self):
        assert self._eval(50.0, limit_type="nominal") == "fail"

    # --- exact ---
    def test_exact_pass_hex(self):
        # measured_value=0x1234 = 4660.0
        assert self._eval(4660.0, limit_type="exact", bus_data="0x1234") == "pass"

    def test_exact_fail_hex(self):
        assert self._eval(9999.0, limit_type="exact", bus_data="0x1234") == "fail"

    def test_exact_pass_nominal(self):
        assert self._eval(42.0, limit_type="exact", limit_nominal=42.0) == "pass"

    def test_exact_fail_nominal(self):
        assert self._eval(43.0, limit_type="exact", limit_nominal=42.0) == "fail"

    def test_exact_no_expected(self):
        assert self._eval(1.0, limit_type="exact") == "fail"

    # --- unknown limit_type ---
    def test_unknown_limit_type(self):
        assert self._eval(42.0, limit_type="foobar") == "record_only"


# ===================================================================
# 5. Integrity hash consistency
# ===================================================================


class TestIntegrityHash:
    """Test compute_integrity_hash() from step_executor."""

    @staticmethod
    def _hash(**kwargs):
        from services.step_executor import compute_integrity_hash
        return compute_integrity_hash(**kwargs)

    def test_same_inputs_same_hash(self):
        args = dict(
            run_id=1, step_id=10, measured_value=58.6,
            pass_fail="pass", measured_at="2026-01-01 00:00:00",
        )
        h1 = self._hash(**args)
        h2 = self._hash(**args)
        assert h1 == h2
        assert isinstance(h1, str)
        assert len(h1) == 64  # SHA-256 hex digest

    def test_different_value_different_hash(self):
        base = dict(
            run_id=1, step_id=10, measured_value=58.6,
            pass_fail="pass", measured_at="2026-01-01 00:00:00",
        )
        h1 = self._hash(**base)
        h2 = self._hash(**{**base, "measured_value": 58.7})
        assert h1 != h2

    def test_different_run_id_different_hash(self):
        base = dict(
            run_id=1, step_id=10, measured_value=58.6,
            pass_fail="pass", measured_at="2026-01-01 00:00:00",
        )
        h1 = self._hash(**base)
        h2 = self._hash(**{**base, "run_id": 2})
        assert h1 != h2

    def test_different_pass_fail_different_hash(self):
        base = dict(
            run_id=1, step_id=10, measured_value=58.6,
            pass_fail="pass", measured_at="2026-01-01 00:00:00",
        )
        h1 = self._hash(**base)
        h2 = self._hash(**{**base, "pass_fail": "fail"})
        assert h1 != h2

    def test_different_timestamp_different_hash(self):
        base = dict(
            run_id=1, step_id=10, measured_value=58.6,
            pass_fail="pass", measured_at="2026-01-01 00:00:00",
        )
        h1 = self._hash(**base)
        h2 = self._hash(**{**base, "measured_at": "2026-01-01 12:00:00"})
        assert h1 != h2

    def test_none_value_hashes(self):
        h = self._hash(
            run_id=1, step_id=10, measured_value=None,
            pass_fail="skipped", measured_at="2026-01-01 00:00:00",
        )
        assert isinstance(h, str) and len(h) == 64


# ===================================================================
# 6. Driver factory
# ===================================================================


def test_driver_factory_simulator():
    """get_driver('simulator') should return a SimulatorDriver."""
    from drivers import get_driver
    from drivers.simulator import SimulatorDriver

    driver = get_driver("simulator")
    assert isinstance(driver, SimulatorDriver)


def test_driver_factory_with_kwargs():
    """get_driver should forward keyword arguments to the driver constructor."""
    from drivers import get_driver

    driver = get_driver("simulator", seed=42, failure_probability=0.5)
    # Verify internal state was set
    assert driver._rng is not None
    assert driver._fail_prob == 0.5


def test_driver_factory_unknown():
    """get_driver for an unsupported mode should raise NotImplementedError."""
    from drivers import get_driver

    with pytest.raises(NotImplementedError, match="nonexistent"):
        get_driver("nonexistent")


# ===================================================================
# 7. Full execution pipeline (integration test)
# ===================================================================


@pytest.mark.asyncio
async def test_full_execution_pipeline(temp_db):
    """Integration test: create run -> start -> execute all steps -> verify results.

    Uses the first available procedure (from seed data) and the simulator
    driver.  Validates that:
      - A test run can be created and started
      - All steps execute to completion
      - The final status is 'passed' or 'failed'
      - Results are stored in the database
      - Integrity hashes are present on every result
    """
    import aiosqlite

    from config import settings
    from services.test_engine import TestEngine
    from services.step_executor import StepExecutor
    from drivers import get_driver

    # ---- Setup: pick the first procedure and create a UUT ----
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Get first procedure
        cursor = await db.execute(
            "SELECT id, subsystem_id FROM test_procedures ORDER BY id LIMIT 1"
        )
        proc = await cursor.fetchone()
        assert proc is not None, "No procedures found — seed data missing?"
        procedure_id = proc["id"]
        subsystem_id = proc["subsystem_id"]

        # Create a UUT for the matching subsystem
        cursor = await db.execute(
            """INSERT INTO units_under_test (subsystem_id, serial_number, part_number, status)
               VALUES (?, 'SN-INTEG-001', 'PN-001', 'available')""",
            (subsystem_id,),
        )
        await db.commit()
        uut_id = cursor.lastrowid

    # ---- Create and start the test run ----
    engine = TestEngine()
    run_id = await engine.create_run(
        procedure_id=procedure_id,
        uut_id=uut_id,
        calibration_id=None,
        started_by=1,
        execution_mode="simulator",
    )

    state = await engine.start_run(run_id)
    assert state.status == "running"
    assert state.total_steps > 0, "Procedure has no steps"

    # ---- Execute each step using StepExecutor + SimulatorDriver ----
    driver = get_driver("simulator", seed=100, failure_probability=0.0)
    await driver.connect()

    step_executor = StepExecutor()
    results = []

    while True:
        step = engine.get_current_step(run_id)
        if step is None:
            break

        step_dict = {
            "id": step.id,
            "step_type": step.step_type,
            "frequency_mhz": step.frequency_mhz,
            "input_power_dbm": step.input_power_dbm,
            "pulse_width_us": step.pulse_width_us,
            "mux_address": step.mux_address,
            "mux_sample_time_us": step.mux_sample_time_us,
            "bus_address": step.bus_address,
            "bus_data": step.bus_data,
            "bus_rw": step.bus_rw,
            "limit_type": step.limit_type,
            "limit_min": step.limit_min,
            "limit_max": step.limit_max,
            "limit_nominal": step.limit_nominal,
            "limit_tolerance": step.limit_tolerance,
            "is_record_only": step.is_record_only,
        }

        result = await step_executor.execute_step(run_id, step_dict, driver)
        step.result = result["pass_fail"]
        results.append(result)
        engine.advance_step(run_id)

    await driver.disconnect()

    # ---- Complete the run ----
    final_state = await engine.complete_run(run_id)

    assert final_state.status in ("passed", "failed"), (
        f"Expected terminal status, got '{final_state.status}'"
    )
    assert final_state.completed_at is not None

    # ---- Verify results in database ----
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Check test_results rows
        cursor = await db.execute(
            "SELECT * FROM test_results WHERE test_run_id = ? ORDER BY id",
            (run_id,),
        )
        db_results = await cursor.fetchall()

        assert len(db_results) == len(results), (
            f"Expected {len(results)} results in DB, found {len(db_results)}"
        )

        # Every result must have an integrity hash
        for row in db_results:
            assert row["integrity_hash"] is not None, (
                f"Result for step {row['step_id']} missing integrity_hash"
            )
            assert len(row["integrity_hash"]) == 64, (
                f"Integrity hash for step {row['step_id']} has wrong length"
            )
            assert row["pass_fail"] in ("pass", "fail", "warning", "record_only", "skipped"), (
                f"Unexpected pass_fail value: {row['pass_fail']}"
            )

        # Check that the run has a signature hash
        cursor = await db.execute(
            "SELECT signature_hash, status, completed_at FROM test_runs WHERE id = ?",
            (run_id,),
        )
        run_row = await cursor.fetchone()
        assert run_row is not None
        assert run_row["signature_hash"] is not None
        assert len(run_row["signature_hash"]) == 64
        assert run_row["status"] in ("passed", "failed")
        assert run_row["completed_at"] is not None

    # ---- Summary ----
    pass_count = sum(1 for r in results if r["pass_fail"] == "pass")
    fail_count = sum(1 for r in results if r["pass_fail"] == "fail")
    other_count = len(results) - pass_count - fail_count
    print(
        f"\n[Pipeline] Run {run_id}: {final_state.status} | "
        f"{len(results)} steps | {pass_count} pass / {fail_count} fail / {other_count} other"
    )


# ===================================================================
# 8. Additional edge-case: unknown measurement type falls back gracefully
# ===================================================================


@pytest.mark.asyncio
async def test_simulator_unknown_measurement_type():
    """An unknown step_type should return a default dict with value=0.0."""
    from drivers.simulator import SimulatorDriver

    driver = SimulatorDriver(seed=0)
    await driver.connect()

    result = await driver.measure("nonexistent_type", {})
    assert result == {"value": 0.0, "secondary_value": None, "raw_data": None}

    await driver.disconnect()


# ===================================================================
# Allow running directly: python tests/test_equipment_integration.py
# ===================================================================

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
