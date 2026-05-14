"""Test runs API router: create, query, and control test run lifecycle."""

import hashlib
import hmac as hmac_mod
from datetime import datetime, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
from config import settings
from services.step_executor import compute_integrity_hash
from services.test_engine import (
    InvalidStateTransition,
    RunState,
    StepInfo,
    TestRunNotActive,
    TestRunNotFound,
    engine,
)
from services.audit import log_audit
from services.execution_runner import start_execution, cancel_execution


router = APIRouter(prefix="/api/test-runs", tags=["test-runs"])


async def _load_terminal_run(run_id: int) -> RunState:
    """Load a terminal-state run from DB as a read-only snapshot."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM test_runs WHERE id = ?", (run_id,))
        run_row = await cursor.fetchone()
        if run_row is None:
            raise HTTPException(status_code=404, detail=f"Test run {run_id} not found")

        cursor = await db.execute(
            "SELECT * FROM test_steps WHERE procedure_id = ? ORDER BY step_number",
            (run_row["procedure_id"],),
        )
        step_rows = await cursor.fetchall()

        cursor = await db.execute(
            "SELECT step_id, pass_fail FROM test_results WHERE test_run_id = ?",
            (run_id,),
        )
        result_map = {r["step_id"]: r["pass_fail"] for r in await cursor.fetchall()}

    steps = [
        StepInfo(
            id=row["id"], step_number=row["step_number"], name=row["name"],
            step_type=row["step_type"], instrument=row["instrument"],
            frequency_mhz=row["frequency_mhz"], input_power_dbm=row["input_power_dbm"],
            pulse_width_us=row["pulse_width_us"], mux_address=row["mux_address"],
            mux_sample_time_us=row["mux_sample_time_us"], bus_address=row["bus_address"],
            bus_data=row["bus_data"], bus_rw=row["bus_rw"],
            limit_type=row["limit_type"], limit_min=row["limit_min"],
            limit_max=row["limit_max"], limit_nominal=row["limit_nominal"],
            limit_tolerance=row["limit_tolerance"], unit=row["unit"],
            instructions=row["instructions"], safety_warning=row["safety_warning"],
            is_optional=bool(row["is_optional"]), is_record_only=bool(row["is_record_only"]),
            result=result_map.get(row["id"]),
        )
        for row in step_rows
    ]

    return RunState(
        run_id=run_id, procedure_id=run_row["procedure_id"],
        uut_id=run_row["uut_id"], calibration_id=run_row["calibration_id"],
        started_by=run_row["started_by"],
        execution_mode=run_row["execution_mode"] or "simulator",
        status=run_row["status"], current_step_index=len(steps),
        total_steps=len(steps), steps=steps,
        started_at=run_row["started_at"], completed_at=run_row["completed_at"],
    )


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class TestRunCreate(BaseModel):
    """Request body for creating a new test run."""

    procedure_id: int
    uut_id: int
    calibration_id: Optional[int] = None
    execution_mode: str = Field(
        default="simulator",
        description="Execution mode: 'simulator' or 'live'",
    )


class TestRunResponse(BaseModel):
    """Response model for a test run."""

    id: int
    procedure_id: int
    uut_id: int
    calibration_id: Optional[int] = None
    started_by: int
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    status: str
    execution_mode: Optional[str] = None
    notes: Optional[str] = None


class RecentTestRunResponse(BaseModel):
    """Response model for recent test runs with joined details."""

    id: int
    procedure_id: int
    procedure_name: Optional[str] = None
    uut_id: int
    serial_number: Optional[str] = None
    subsystem_name: Optional[str] = None
    drawing_no: Optional[str] = None
    started_by: int
    operator_name: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    status: str
    execution_mode: Optional[str] = None


class TestRunStateResponse(BaseModel):
    """Full run state including steps, returned by the state endpoint."""

    run_id: int
    procedure_id: int
    uut_id: int
    calibration_id: Optional[int] = None
    started_by: int
    execution_mode: str
    status: str
    current_step_index: int
    total_steps: int
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    steps: list[dict] = []
    # Joined metadata for display
    subsystem_drawing_no: Optional[str] = None
    subsystem_name: Optional[str] = None
    procedure_code: Optional[str] = None
    procedure_name: Optional[str] = None
    serial_number: Optional[str] = None
    operator_name: Optional[str] = None


class ActionResponse(BaseModel):
    """Generic response for state transition actions."""

    run_id: int
    status: str
    message: str


class IntegrityVerificationResponse(BaseModel):
    """Response model for integrity verification of a completed test run."""

    run_id: int
    signature_valid: bool
    results_verified: int
    results_tampered: int
    tampered_step_ids: list[int]
    signature_hash: Optional[str] = None
    computed_hash: Optional[str] = None
    verified_at: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=TestRunResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new test run",
)
async def create_test_run(
    body: TestRunCreate,
    current_user: UserInDB = Depends(require_role("technician")),
) -> TestRunResponse:
    """Create a new test run in pending state.

    Requires at least the **technician** role. The procedure and UUT must
    both exist in the database. If the procedure requires calibration,
    a valid (unexpired) calibration must exist for the subsystem.
    """
    # --- Enforce calibration requirement ---
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT tp.requires_calibration, tp.subsystem_id, tp.code
               FROM test_procedures tp WHERE tp.id = ?""",
            (body.procedure_id,),
        )
        proc_row = await cursor.fetchone()

    if proc_row and proc_row["requires_calibration"]:
        sub_id = proc_row["subsystem_id"]
        async with aiosqlite.connect(settings.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """SELECT id FROM calibrations
                   WHERE subsystem_id = ?
                     AND status = 'valid'
                     AND expires_at > datetime('now')
                   ORDER BY performed_at DESC LIMIT 1""",
                (sub_id,),
            )
            valid_cal = await cursor.fetchone()

        if valid_cal is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Procedure '{proc_row['code']}' requires a valid daily calibration. "
                       f"No valid calibration found for subsystem {sub_id}. "
                       f"Please perform a daily calibration before running this test.",
            )

    try:
        run_id = await engine.create_run(
            procedure_id=body.procedure_id,
            uut_id=body.uut_id,
            calibration_id=body.calibration_id,
            started_by=current_user.id,
            execution_mode=body.execution_mode,
        )
    except TestRunNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    await log_audit(
        user_id=current_user.id,
        action="create",
        entity_type="test_run",
        entity_id=run_id,
        details=f"procedure_id={body.procedure_id} uut_id={body.uut_id} mode={body.execution_mode}",
    )

    # Fetch the created row from the database for the response
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM test_runs WHERE id = ?", (run_id,)
        )
        row = await cursor.fetchone()

    return TestRunResponse(
        id=row["id"],
        procedure_id=row["procedure_id"],
        uut_id=row["uut_id"],
        calibration_id=row["calibration_id"],
        started_by=row["started_by"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        status=row["status"],
        execution_mode=row["execution_mode"],
        notes=row["notes"],
    )


@router.get(
    "/recent",
    response_model=list[RecentTestRunResponse],
    summary="Get recent test runs",
)
async def get_recent_test_runs(
    limit: int = Query(default=20, ge=1, le=100, description="Max results"),
    current_user: UserInDB = Depends(get_current_user),
) -> list[RecentTestRunResponse]:
    """Return the most recent test runs with joined subsystem, UUT, and user info.

    Used by the dashboard's RecentTestsTable component.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT
                tr.id,
                tr.procedure_id,
                tp.name       AS procedure_name,
                tr.uut_id,
                uut.serial_number,
                s.name        AS subsystem_name,
                s.drawing_no,
                tr.started_by,
                u.full_name   AS operator_name,
                tr.started_at,
                tr.completed_at,
                tr.status,
                tr.execution_mode
            FROM test_runs tr
            LEFT JOIN test_procedures tp ON tp.id = tr.procedure_id
            LEFT JOIN units_under_test uut ON uut.id = tr.uut_id
            LEFT JOIN subsystems s ON s.id = tp.subsystem_id
            LEFT JOIN users u ON u.id = tr.started_by
            ORDER BY tr.started_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()

    return [
        RecentTestRunResponse(
            id=row["id"],
            procedure_id=row["procedure_id"],
            procedure_name=row["procedure_name"],
            uut_id=row["uut_id"],
            serial_number=row["serial_number"],
            subsystem_name=row["subsystem_name"],
            drawing_no=row["drawing_no"],
            started_by=row["started_by"],
            operator_name=row["operator_name"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            status=row["status"],
            execution_mode=row["execution_mode"],
        )
        for row in rows
    ]


@router.get(
    "/{run_id}",
    response_model=TestRunResponse,
    summary="Get test run details",
)
async def get_test_run(
    run_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> TestRunResponse:
    """Return a single test run by ID from the database."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM test_runs WHERE id = ?", (run_id,)
        )
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run {run_id} not found",
        )

    return TestRunResponse(
        id=row["id"],
        procedure_id=row["procedure_id"],
        uut_id=row["uut_id"],
        calibration_id=row["calibration_id"],
        started_by=row["started_by"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
        status=row["status"],
        execution_mode=row["execution_mode"],
        notes=row["notes"],
    )


@router.get(
    "/{run_id}/state",
    response_model=TestRunStateResponse,
    summary="Get full run state (in-memory)",
)
async def get_test_run_state(
    run_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> TestRunStateResponse:
    """Return the full in-memory state of an active test run, including steps.

    If the run is not currently loaded in the engine, it will be loaded from
    the database automatically.  Terminal-state runs (passed/failed/aborted)
    are loaded as read-only snapshots without being added to the engine.
    """
    try:
        state = engine.get_run_state(run_id)
    except TestRunNotActive:
        try:
            state = await engine.load_existing_run(run_id)
        except InvalidStateTransition:
            # Terminal run — load directly from DB as a read-only snapshot
            state = await _load_terminal_run(run_id)
        except TestRunNotFound as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(exc),
            )

    d = state.to_dict()

    # Fetch joined metadata for the data sheet header
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT
                s.drawing_no      AS subsystem_drawing_no,
                s.name            AS subsystem_name,
                tp.code           AS procedure_code,
                tp.name           AS procedure_name,
                uut.serial_number,
                u.full_name       AS operator_name
            FROM test_runs tr
            LEFT JOIN test_procedures tp ON tp.id = tr.procedure_id
            LEFT JOIN subsystems s ON s.id = tp.subsystem_id
            LEFT JOIN units_under_test uut ON uut.id = tr.uut_id
            LEFT JOIN users u ON u.id = tr.started_by
            WHERE tr.id = ?
            """,
            (run_id,),
        )
        meta = await cursor.fetchone()

    if meta:
        d["subsystem_drawing_no"] = meta["subsystem_drawing_no"]
        d["subsystem_name"] = meta["subsystem_name"]
        d["procedure_code"] = meta["procedure_code"]
        d["procedure_name"] = meta["procedure_name"]
        d["serial_number"] = meta["serial_number"]
        d["operator_name"] = meta["operator_name"]

    return TestRunStateResponse(**d)


@router.post(
    "/{run_id}/start",
    response_model=ActionResponse,
    summary="Start a test run",
)
async def start_test_run(
    run_id: int,
    current_user: UserInDB = Depends(require_role("technician")),
) -> ActionResponse:
    """Transition a test run from *pending* to *running*."""
    try:
        state = await engine.start_run(run_id)
    except TestRunNotActive:
        # Try loading first, then starting
        try:
            await engine.load_existing_run(run_id)
            state = await engine.start_run(run_id)
        except TestRunNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except InvalidStateTransition as exc:
            raise HTTPException(status_code=409, detail=str(exc))
    except InvalidStateTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    await log_audit(
        user_id=current_user.id,
        action="start",
        entity_type="test_run",
        entity_id=run_id,
    )

    # Kick off step execution in the background
    await start_execution(engine, run_id)

    return ActionResponse(
        run_id=run_id,
        status=state.status,
        message=f"Test run {run_id} started",
    )


@router.post(
    "/{run_id}/pause",
    response_model=ActionResponse,
    summary="Pause a test run",
)
async def pause_test_run(
    run_id: int,
    current_user: UserInDB = Depends(require_role("technician")),
) -> ActionResponse:
    """Transition a test run from *running* to *paused*."""
    try:
        state = await engine.pause_run(run_id)
    except TestRunNotActive as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except InvalidStateTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    await log_audit(
        user_id=current_user.id,
        action="pause",
        entity_type="test_run",
        entity_id=run_id,
    )

    return ActionResponse(
        run_id=run_id,
        status=state.status,
        message=f"Test run {run_id} paused",
    )


@router.post(
    "/{run_id}/resume",
    response_model=ActionResponse,
    summary="Resume a paused test run",
)
async def resume_test_run(
    run_id: int,
    current_user: UserInDB = Depends(require_role("technician")),
) -> ActionResponse:
    """Transition a test run from *paused* back to *running*."""
    try:
        state = await engine.resume_run(run_id)
    except TestRunNotActive as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except InvalidStateTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    await log_audit(
        user_id=current_user.id,
        action="resume",
        entity_type="test_run",
        entity_id=run_id,
    )

    return ActionResponse(
        run_id=run_id,
        status=state.status,
        message=f"Test run {run_id} resumed",
    )


@router.post(
    "/{run_id}/abort",
    response_model=ActionResponse,
    summary="Abort a test run",
)
async def abort_test_run(
    run_id: int,
    current_user: UserInDB = Depends(require_role("technician")),
) -> ActionResponse:
    """Transition a test run to *aborted* from *running* or *paused*."""
    cancel_execution(run_id)
    try:
        state = await engine.abort_run(run_id)
    except TestRunNotActive as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except InvalidStateTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    await log_audit(
        user_id=current_user.id,
        action="abort",
        entity_type="test_run",
        entity_id=run_id,
    )

    return ActionResponse(
        run_id=run_id,
        status=state.status,
        message=f"Test run {run_id} aborted",
    )


# ---------------------------------------------------------------------------
# Integrity verification
# ---------------------------------------------------------------------------


@router.get(
    "/{run_id}/verify",
    response_model=IntegrityVerificationResponse,
    summary="Verify integrity of a completed test run",
)
async def verify_test_run_integrity(
    run_id: int,
    current_user: UserInDB = Depends(require_role("engineer")),
) -> IntegrityVerificationResponse:
    """Re-compute HMAC-SHA256 hashes for every result and the run-level
    signature, comparing against stored values to detect tampering.

    Requires at least the **engineer** role.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Load the test run
        cursor = await db.execute(
            "SELECT * FROM test_runs WHERE id = ?", (run_id,)
        )
        run_row = await cursor.fetchone()

        if run_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Test run {run_id} not found",
            )

        run_status = run_row["status"]
        if run_status not in ("passed", "failed"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot verify a run with status '{run_status}'. "
                       f"Only completed (passed/failed) runs can be verified.",
            )

        # Load all results ordered by step number
        cursor = await db.execute(
            """SELECT tr.*, ts.step_number
               FROM test_results tr
               JOIN test_steps ts ON ts.id = tr.step_id
               WHERE tr.test_run_id = ?
               ORDER BY ts.step_number""",
            (run_id,),
        )
        result_rows = await cursor.fetchall()

    # --- Verify individual result integrity hashes ---
    tampered_step_ids: list[int] = []
    verified_hashes: list[str] = []

    for row in result_rows:
        recomputed = compute_integrity_hash(
            run_id=run_id,
            step_id=row["step_id"],
            measured_value=row["measured_value"],
            pass_fail=row["pass_fail"],
            measured_at=row["measured_at"],
        )
        stored = row["integrity_hash"]
        if stored != recomputed:
            tampered_step_ids.append(row["step_id"])
        if stored:
            verified_hashes.append(stored)

    # --- Verify run-level signature hash ---
    stored_signature = run_row["signature_hash"]
    concatenated = ":".join(verified_hashes)
    msg = f"{run_id}:{run_status}:{run_row['completed_at']}:{concatenated}"
    computed_signature = hmac_mod.new(
        settings.SECRET_KEY.encode(), msg.encode(), hashlib.sha256,
    ).hexdigest()

    signature_valid = (stored_signature == computed_signature)

    verified_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return IntegrityVerificationResponse(
        run_id=run_id,
        signature_valid=signature_valid,
        results_verified=len(result_rows),
        results_tampered=len(tampered_step_ids),
        tampered_step_ids=tampered_step_ids,
        signature_hash=stored_signature,
        computed_hash=computed_signature,
        verified_at=verified_at,
    )


# ---------------------------------------------------------------------------
# Result detail endpoint
# ---------------------------------------------------------------------------


class ResultStepDetail(BaseModel):
    """A single test result with its associated step info."""

    step_number: int
    name: str
    step_type: str
    instrument: Optional[str] = None
    frequency_mhz: Optional[float] = None
    input_power_dbm: Optional[float] = None
    limit_type: Optional[str] = None
    limit_min: Optional[float] = None
    limit_max: Optional[float] = None
    limit_nominal: Optional[float] = None
    limit_tolerance: Optional[float] = None
    unit: Optional[str] = None
    measured_value: Optional[float] = None
    secondary_value: Optional[float] = None
    pass_fail: Optional[str] = None
    measured_at: Optional[str] = None
    integrity_hash: Optional[str] = None
    is_record_only: bool = False


class ResultSummary(BaseModel):
    """Summary counts for a test run."""

    total: int
    passed: int
    failed: int
    warnings: int
    record_only: int
    skipped: int


class ResultDetailResponse(BaseModel):
    """Full detail response for a completed (or in-progress) test run."""

    id: int
    procedure_code: Optional[str] = None
    procedure_name: Optional[str] = None
    subsystem_drawing_no: Optional[str] = None
    subsystem_name: Optional[str] = None
    serial_number: Optional[str] = None
    operator_name: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    status: str
    execution_mode: Optional[str] = None
    signature_hash: Optional[str] = None
    signed_by: Optional[str] = None
    results: list[ResultStepDetail] = []
    summary: ResultSummary


@router.get(
    "/{run_id}/detail",
    response_model=ResultDetailResponse,
    summary="Get full result detail for a test run",
)
async def get_result_detail(
    run_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> ResultDetailResponse:
    """Return the full detail for a test run including all results with step info.

    Joins test_runs, test_procedures, subsystems, units_under_test, users,
    test_results, and test_steps to produce a complete data sheet view.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Fetch run metadata with joins
        cursor = await db.execute(
            """
            SELECT
                tr.id,
                tp.code           AS procedure_code,
                tp.name           AS procedure_name,
                s.drawing_no      AS subsystem_drawing_no,
                s.name            AS subsystem_name,
                uut.serial_number,
                u.full_name       AS operator_name,
                tr.started_at,
                tr.completed_at,
                tr.status,
                tr.execution_mode,
                tr.signature_hash,
                signer.full_name  AS signed_by
            FROM test_runs tr
            LEFT JOIN test_procedures tp ON tp.id = tr.procedure_id
            LEFT JOIN subsystems s ON s.id = tp.subsystem_id
            LEFT JOIN units_under_test uut ON uut.id = tr.uut_id
            LEFT JOIN users u ON u.id = tr.started_by
            LEFT JOIN users signer ON signer.id = tr.signed_by
            WHERE tr.id = ?
            """,
            (run_id,),
        )
        run_row = await cursor.fetchone()

        if run_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Test run {run_id} not found",
            )

        # Fetch all results joined with step definitions
        cursor = await db.execute(
            """
            SELECT
                ts.step_number,
                ts.name,
                ts.step_type,
                ts.instrument,
                ts.frequency_mhz,
                ts.input_power_dbm,
                ts.limit_type,
                ts.limit_min,
                ts.limit_max,
                ts.limit_nominal,
                ts.limit_tolerance,
                ts.unit,
                ts.is_record_only,
                res.measured_value,
                res.secondary_value,
                res.pass_fail,
                res.measured_at,
                res.integrity_hash
            FROM test_steps ts
            LEFT JOIN test_results res
                ON res.step_id = ts.id AND res.test_run_id = ?
            WHERE ts.procedure_id = (
                SELECT procedure_id FROM test_runs WHERE id = ?
            )
            ORDER BY ts.step_number
            """,
            (run_id, run_id),
        )
        result_rows = await cursor.fetchall()

    # Build result list
    results: list[ResultStepDetail] = []
    passed = 0
    failed = 0
    warnings = 0
    record_only = 0
    skipped = 0

    for row in result_rows:
        pf = row["pass_fail"]
        if pf == "pass":
            passed += 1
        elif pf == "fail":
            failed += 1
        elif pf == "warning":
            warnings += 1
        elif pf == "record_only":
            record_only += 1
        elif pf == "skipped":
            skipped += 1

        results.append(
            ResultStepDetail(
                step_number=row["step_number"],
                name=row["name"],
                step_type=row["step_type"],
                instrument=row["instrument"],
                frequency_mhz=row["frequency_mhz"],
                input_power_dbm=row["input_power_dbm"],
                limit_type=row["limit_type"],
                limit_min=row["limit_min"],
                limit_max=row["limit_max"],
                limit_nominal=row["limit_nominal"],
                limit_tolerance=row["limit_tolerance"],
                unit=row["unit"],
                measured_value=row["measured_value"],
                secondary_value=row["secondary_value"],
                pass_fail=pf,
                measured_at=row["measured_at"],
                integrity_hash=row["integrity_hash"],
                is_record_only=bool(row["is_record_only"]),
            )
        )

    summary = ResultSummary(
        total=len(results),
        passed=passed,
        failed=failed,
        warnings=warnings,
        record_only=record_only,
        skipped=skipped,
    )

    return ResultDetailResponse(
        id=run_row["id"],
        procedure_code=run_row["procedure_code"],
        procedure_name=run_row["procedure_name"],
        subsystem_drawing_no=run_row["subsystem_drawing_no"],
        subsystem_name=run_row["subsystem_name"],
        serial_number=run_row["serial_number"],
        operator_name=run_row["operator_name"],
        started_at=run_row["started_at"],
        completed_at=run_row["completed_at"],
        status=run_row["status"],
        execution_mode=run_row["execution_mode"],
        signature_hash=run_row["signature_hash"],
        signed_by=run_row["signed_by"],
        results=results,
        summary=summary,
    )
