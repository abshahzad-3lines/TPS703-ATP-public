"""TestEngine service — manages active test run lifecycle via a state machine.

State transitions:
    pending  -> running  (start)
    running  -> paused   (pause)
    paused   -> running  (resume)
    running  -> passed / failed  (complete — based on step results)
    running  -> aborted  (abort)
    paused   -> aborted  (abort)

All other transitions raise ``InvalidStateTransition``.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_mod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite

from config import settings


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class InvalidStateTransition(Exception):
    """Raised when a state transition is not allowed."""

    def __init__(self, current: str, target: str) -> None:
        self.current = current
        self.target = target
        super().__init__(
            f"Cannot transition from '{current}' to '{target}'"
        )


class TestRunNotFound(Exception):
    """Raised when a test run ID is not found."""

    def __init__(self, run_id: int) -> None:
        self.run_id = run_id
        super().__init__(f"Test run {run_id} not found")


class TestRunNotActive(Exception):
    """Raised when attempting to operate on a run that is not in memory."""

    def __init__(self, run_id: int) -> None:
        self.run_id = run_id
        super().__init__(f"Test run {run_id} is not active in the engine")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

VALID_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"running"},
    "running": {"paused", "passed", "failed", "aborted"},
    "paused": {"running", "aborted"},
    # Terminal states — no transitions out
    "passed": set(),
    "failed": set(),
    "aborted": set(),
}


@dataclass
class StepInfo:
    """Lightweight representation of a test step loaded from the database."""

    id: int
    step_number: int
    name: str
    step_type: str
    instrument: Optional[str] = None
    frequency_mhz: Optional[float] = None
    input_power_dbm: Optional[float] = None
    pulse_width_us: Optional[float] = None
    mux_address: Optional[str] = None
    mux_sample_time_us: Optional[float] = None
    bus_address: Optional[str] = None
    bus_data: Optional[str] = None
    bus_rw: Optional[str] = None
    limit_type: Optional[str] = None
    limit_min: Optional[float] = None
    limit_max: Optional[float] = None
    limit_nominal: Optional[float] = None
    limit_tolerance: Optional[float] = None
    unit: Optional[str] = None
    instructions: Optional[str] = None
    safety_warning: Optional[str] = None
    is_optional: bool = False
    is_record_only: bool = False
    # Populated at runtime when a result is recorded
    result: Optional[str] = None


@dataclass
class RunState:
    """In-memory state for an active test run."""

    run_id: int
    procedure_id: int
    uut_id: int
    calibration_id: Optional[int]
    started_by: int
    execution_mode: str
    status: str
    current_step_index: int = 0
    total_steps: int = 0
    steps: list[StepInfo] = field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """Serialise the run state for API responses."""
        return {
            "run_id": self.run_id,
            "procedure_id": self.procedure_id,
            "uut_id": self.uut_id,
            "calibration_id": self.calibration_id,
            "started_by": self.started_by,
            "execution_mode": self.execution_mode,
            "status": self.status,
            "current_step_index": self.current_step_index,
            "total_steps": self.total_steps,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "steps": [
                {
                    "id": s.id,
                    "step_number": s.step_number,
                    "name": s.name,
                    "step_type": s.step_type,
                    "instrument": s.instrument,
                    "frequency_mhz": s.frequency_mhz,
                    "input_power_dbm": s.input_power_dbm,
                    "pulse_width_us": s.pulse_width_us,
                    "limit_type": s.limit_type,
                    "limit_min": s.limit_min,
                    "limit_max": s.limit_max,
                    "limit_nominal": s.limit_nominal,
                    "limit_tolerance": s.limit_tolerance,
                    "unit": s.unit,
                    "instructions": s.instructions,
                    "safety_warning": s.safety_warning,
                    "is_optional": s.is_optional,
                    "is_record_only": s.is_record_only,
                    "result": s.result,
                }
                for s in self.steps
            ],
        }


class TestEngine:
    """Manages active test runs with an in-memory state dict backed by SQLite."""

    def __init__(self) -> None:
        self._active_runs: dict[int, RunState] = {}

    def _validate_transition(self, current: str, target: str) -> None:
        allowed = VALID_TRANSITIONS.get(current, set())
        if target not in allowed:
            raise InvalidStateTransition(current, target)

    def _get_active(self, run_id: int) -> RunState:
        state = self._active_runs.get(run_id)
        if state is None:
            raise TestRunNotActive(run_id)
        return state

    @staticmethod
    def _utcnow() -> str:
        """Return current UTC time as an ISO-formatted string."""
        return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # -- public API ----------------------------------------------------------

    async def create_run(
        self,
        procedure_id: int,
        uut_id: int,
        calibration_id: int | None,
        started_by: int,
        execution_mode: str = "simulator",
    ) -> int:
        """Create a new test run in the DB and load its steps into memory.

        Returns:
            The newly created ``test_runs.id``.

        Raises:
            TestRunNotFound: If the procedure or UUT does not exist.
        """
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("PRAGMA foreign_keys = ON")

            # Validate procedure exists
            cursor = await db.execute(
                "SELECT id FROM test_procedures WHERE id = ?", (procedure_id,)
            )
            if await cursor.fetchone() is None:
                raise TestRunNotFound(procedure_id)

            # Validate UUT exists
            cursor = await db.execute(
                "SELECT id FROM units_under_test WHERE id = ?", (uut_id,)
            )
            if await cursor.fetchone() is None:
                raise TestRunNotFound(uut_id)

            # Insert test run
            cursor = await db.execute(
                """
                INSERT INTO test_runs
                    (procedure_id, uut_id, calibration_id, started_by,
                     status, execution_mode, started_at)
                VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'))
                """,
                (procedure_id, uut_id, calibration_id, started_by, execution_mode),
            )
            await db.commit()
            run_id = cursor.lastrowid

            # Load steps for the procedure
            cursor = await db.execute(
                "SELECT * FROM test_steps WHERE procedure_id = ? ORDER BY step_number",
                (procedure_id,),
            )
            rows = await cursor.fetchall()

        steps = [
            StepInfo(
                id=row["id"],
                step_number=row["step_number"],
                name=row["name"],
                step_type=row["step_type"],
                instrument=row["instrument"],
                frequency_mhz=row["frequency_mhz"],
                input_power_dbm=row["input_power_dbm"],
                pulse_width_us=row["pulse_width_us"],
                mux_address=row["mux_address"],
                mux_sample_time_us=row["mux_sample_time_us"],
                bus_address=row["bus_address"],
                bus_data=row["bus_data"],
                bus_rw=row["bus_rw"],
                limit_type=row["limit_type"],
                limit_min=row["limit_min"],
                limit_max=row["limit_max"],
                limit_nominal=row["limit_nominal"],
                limit_tolerance=row["limit_tolerance"],
                unit=row["unit"],
                instructions=row["instructions"],
                safety_warning=row["safety_warning"],
                is_optional=bool(row["is_optional"]),
                is_record_only=bool(row["is_record_only"]),
            )
            for row in rows
        ]

        state = RunState(
            run_id=run_id,
            procedure_id=procedure_id,
            uut_id=uut_id,
            calibration_id=calibration_id,
            started_by=started_by,
            execution_mode=execution_mode,
            status="pending",
            current_step_index=0,
            total_steps=len(steps),
            steps=steps,
        )
        self._active_runs[run_id] = state
        return run_id

    async def start_run(self, run_id: int) -> RunState:
        """Transition pending -> running."""
        state = self._get_active(run_id)
        self._validate_transition(state.status, "running")
        state.status = "running"
        state.started_at = self._utcnow()

        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                "UPDATE test_runs SET status = 'running', started_at = ? WHERE id = ?",
                (state.started_at, run_id),
            )
            await db.commit()
        return state

    async def pause_run(self, run_id: int) -> RunState:
        """Transition running -> paused."""
        state = self._get_active(run_id)
        self._validate_transition(state.status, "paused")
        state.status = "paused"

        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                "UPDATE test_runs SET status = 'paused' WHERE id = ?", (run_id,)
            )
            await db.commit()
        return state

    async def resume_run(self, run_id: int) -> RunState:
        """Transition paused -> running."""
        state = self._get_active(run_id)
        self._validate_transition(state.status, "running")
        state.status = "running"

        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                "UPDATE test_runs SET status = 'running' WHERE id = ?", (run_id,)
            )
            await db.commit()
        return state

    async def abort_run(self, run_id: int) -> RunState:
        """Transition running/paused -> aborted."""
        state = self._get_active(run_id)
        self._validate_transition(state.status, "aborted")
        state.status = "aborted"
        state.completed_at = self._utcnow()

        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                "UPDATE test_runs SET status = 'aborted', completed_at = ? WHERE id = ?",
                (state.completed_at, run_id),
            )
            await db.commit()

        self._active_runs.pop(run_id, None)
        return state

    async def complete_run(self, run_id: int) -> RunState:
        """Evaluate step results; set passed or failed.

        A run passes only if every non-optional, non-record-only step has a
        result of ``"pass"`` or ``"warning"``.  Any ``"fail"`` result causes
        the entire run to fail.

        After determining the final status, computes an HMAC-SHA256 signature
        hash over all individual result integrity hashes (in step order) plus
        the run metadata, and stores it in ``test_runs.signature_hash``.
        """
        state = self._get_active(run_id)
        self._validate_transition(state.status, "passed")  # validates from running

        has_failure = any(
            s.result == "fail"
            for s in state.steps
            if not s.is_optional and not s.is_record_only
        )

        final_status = "failed" if has_failure else "passed"
        state.status = final_status
        state.completed_at = self._utcnow()

        # Compute run-level signature hash over all result integrity hashes
        signature_hash = await self._compute_signature_hash(
            run_id, final_status, state.completed_at
        )

        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                "UPDATE test_runs SET status = ?, completed_at = ?, signature_hash = ? WHERE id = ?",
                (final_status, state.completed_at, signature_hash, run_id),
            )
            await db.commit()

        self._active_runs.pop(run_id, None)
        return state

    @staticmethod
    async def _compute_signature_hash(
        run_id: int, status: str, completed_at: str,
    ) -> str:
        """Compute HMAC-SHA256 signature hash for a completed test run.

        The signature covers all individual result integrity hashes (ordered by
        step number) concatenated with ':', plus the run_id, final status, and
        completion timestamp.
        """
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """SELECT tr.integrity_hash
                   FROM test_results tr
                   JOIN test_steps ts ON ts.id = tr.step_id
                   WHERE tr.test_run_id = ?
                   ORDER BY ts.step_number""",
                (run_id,),
            )
            rows = await cursor.fetchall()

        all_hashes = [row["integrity_hash"] for row in rows if row["integrity_hash"]]
        concatenated = ":".join(all_hashes)
        msg = f"{run_id}:{status}:{completed_at}:{concatenated}"
        return hmac_mod.new(
            settings.SECRET_KEY.encode(), msg.encode(), hashlib.sha256,
        ).hexdigest()

    def get_run_state(self, run_id: int) -> RunState:
        """Return the in-memory state of an active test run."""
        return self._get_active(run_id)

    def get_current_step(self, run_id: int) -> StepInfo | None:
        """Return the current step, or None if all steps are done."""
        state = self._get_active(run_id)
        if state.current_step_index >= state.total_steps:
            return None
        return state.steps[state.current_step_index]

    def advance_step(self, run_id: int) -> StepInfo | None:
        """Move to the next step and return it, or None if finished."""
        state = self._get_active(run_id)
        if state.current_step_index < state.total_steps - 1:
            state.current_step_index += 1
            return state.steps[state.current_step_index]
        state.current_step_index = state.total_steps
        return None

    def restart_run(self, run_id: int) -> RunState:
        """Reset a running/paused run back to step 0, clearing all in-memory results."""
        state = self._get_active(run_id)
        if state.status not in ("running", "paused"):
            raise InvalidStateTransition(state.status, "restart")
        state.current_step_index = 0
        state.status = "running"
        for step in state.steps:
            step.result = None
        return state

    def retake_previous_step(self, run_id: int) -> tuple[StepInfo | None, int]:
        """Go back one step, clear its result, and return it for re-measurement.

        Returns (step, step_index) or (None, -1) if at the beginning.
        """
        state = self._get_active(run_id)
        if state.current_step_index <= 0:
            return None, -1
        state.current_step_index -= 1
        step = state.steps[state.current_step_index]
        step.result = None
        return step, state.current_step_index

    async def load_existing_run(self, run_id: int) -> RunState:
        """Reload a non-terminal run from the database into memory.

        Useful when the server restarts and a run needs to be resumed.

        Raises:
            TestRunNotFound: If the run does not exist in the DB.
            InvalidStateTransition: If the run is already in a terminal state.
        """
        if run_id in self._active_runs:
            return self._active_runs[run_id]

        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM test_runs WHERE id = ?", (run_id,)
            )
            run_row = await cursor.fetchone()
            if run_row is None:
                raise TestRunNotFound(run_id)

            db_status = run_row["status"]
            if db_status in ("passed", "failed", "aborted"):
                raise InvalidStateTransition(db_status, "reload")

            # Load steps
            cursor = await db.execute(
                "SELECT * FROM test_steps WHERE procedure_id = ? ORDER BY step_number",
                (run_row["procedure_id"],),
            )
            step_rows = await cursor.fetchall()

            # Load existing results to reconstruct step status
            cursor = await db.execute(
                "SELECT step_id, pass_fail FROM test_results WHERE test_run_id = ?",
                (run_id,),
            )
            result_rows = await cursor.fetchall()
            result_map: dict[int, str] = {
                r["step_id"]: r["pass_fail"] for r in result_rows
            }

        steps = []
        for row in step_rows:
            steps.append(StepInfo(
                id=row["id"],
                step_number=row["step_number"],
                name=row["name"],
                step_type=row["step_type"],
                instrument=row["instrument"],
                frequency_mhz=row["frequency_mhz"],
                input_power_dbm=row["input_power_dbm"],
                pulse_width_us=row["pulse_width_us"],
                mux_address=row["mux_address"],
                mux_sample_time_us=row["mux_sample_time_us"],
                bus_address=row["bus_address"],
                bus_data=row["bus_data"],
                bus_rw=row["bus_rw"],
                limit_type=row["limit_type"],
                limit_min=row["limit_min"],
                limit_max=row["limit_max"],
                limit_nominal=row["limit_nominal"],
                limit_tolerance=row["limit_tolerance"],
                unit=row["unit"],
                instructions=row["instructions"],
                safety_warning=row["safety_warning"],
                is_optional=bool(row["is_optional"]),
                is_record_only=bool(row["is_record_only"]),
                result=result_map.get(row["id"]),
            ))

        # Determine current step index from results
        current_idx = 0
        for i, step in enumerate(steps):
            if step.result is None:
                current_idx = i
                break
        else:
            current_idx = len(steps)

        state = RunState(
            run_id=run_id,
            procedure_id=run_row["procedure_id"],
            uut_id=run_row["uut_id"],
            calibration_id=run_row["calibration_id"],
            started_by=run_row["started_by"],
            execution_mode=run_row["execution_mode"] or "simulator",
            status=db_status,
            current_step_index=current_idx,
            total_steps=len(steps),
            steps=steps,
            started_at=run_row["started_at"],
            completed_at=run_row["completed_at"],
        )
        self._active_runs[run_id] = state
        return state

    @property
    def active_run_ids(self) -> list[int]:
        """Return IDs of all currently active runs."""
        return list(self._active_runs.keys())


# Module-level singleton
engine = TestEngine()
