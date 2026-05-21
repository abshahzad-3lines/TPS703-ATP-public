"""Calibration management API — record calibrations and check 24h validity."""

from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
import dbx
from config import settings
from services.audit import log_audit


router = APIRouter(prefix="/api/calibrations", tags=["calibrations"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CalResultItem(BaseModel):
    """A single calibration measurement result."""

    parameter_name: str
    measured_value: float
    limit_min: Optional[float] = None
    limit_max: Optional[float] = None
    unit: str
    pass_fail: str = Field(
        ...,
        pattern="^(pass|fail)$",
        description="Result: pass or fail",
    )


class CalibrationCreate(BaseModel):
    """Request body for creating a new calibration record."""

    subsystem_id: int
    cal_type: str = "daily"
    ref_cable_sn: Optional[str] = None
    equipment_ids: list[int] = Field(
        default_factory=list,
        description="IDs of equipment used during calibration",
    )
    results: list[CalResultItem] = Field(
        default_factory=list,
        description="List of calibration measurement results",
    )


class CalResultResponse(BaseModel):
    """A calibration result in API responses."""

    id: int
    calibration_id: int
    parameter_name: str
    measured_value: float
    limit_min: Optional[float] = None
    limit_max: Optional[float] = None
    unit: str
    pass_fail: str


class CalibrationResponse(BaseModel):
    """Calibration record returned by the API."""

    id: int
    subsystem_id: int
    performed_by: int
    cal_type: str
    ref_cable_sn: Optional[str] = None
    performed_at: str
    expires_at: str
    status: str
    results: list[CalResultResponse] = []


class ValidCalibrationResponse(BaseModel):
    """Response for the valid-calibration check endpoint."""

    id: int
    subsystem_id: int
    performed_by: int
    cal_type: str
    ref_cable_sn: Optional[str] = None
    performed_at: str
    expires_at: str
    status: str
    time_remaining_seconds: float
    time_remaining_human: str
    results: list[CalResultResponse] = []


# ---------------------------------------------------------------------------
# POST /api/calibrations — Record a new calibration
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=CalibrationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_calibration(
    cal_data: CalibrationCreate,
    current_user: UserInDB = Depends(require_role("technician")),
) -> CalibrationResponse:
    """Record a new calibration for a subsystem.

    Requires Technician role or higher.  Automatically sets ``performed_at``
    to the current UTC time and ``expires_at`` to 24 hours later.
    """
    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")

        # Verify subsystem exists
        cursor = await db.execute(
            "SELECT id FROM subsystems WHERE id = ?", (cal_data.subsystem_id,)
        )
        if await cursor.fetchone() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subsystem with id {cal_data.subsystem_id} not found",
            )

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(hours=24)
        performed_at_str = now.strftime("%Y-%m-%d %H:%M:%S")
        expires_at_str = expires_at.strftime("%Y-%m-%d %H:%M:%S")

        # Determine overall status from individual results
        overall_status = "valid"
        if cal_data.results and any(r.pass_fail == "fail" for r in cal_data.results):
            overall_status = "invalid"

        # Insert calibration record
        cursor = await db.execute(
            """
            INSERT INTO calibrations
                (subsystem_id, performed_by, cal_type, ref_cable_sn,
                 performed_at, expires_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cal_data.subsystem_id,
                current_user.id,
                cal_data.cal_type,
                cal_data.ref_cable_sn,
                performed_at_str,
                expires_at_str,
                overall_status,
            ),
        )
        cal_id = cursor.lastrowid

        # Insert calibration results
        result_rows: list[CalResultResponse] = []
        for item in cal_data.results:
            cur = await db.execute(
                """
                INSERT INTO calibration_results
                    (calibration_id, parameter_name, measured_value,
                     limit_min, limit_max, unit, pass_fail)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cal_id,
                    item.parameter_name,
                    item.measured_value,
                    item.limit_min,
                    item.limit_max,
                    item.unit,
                    item.pass_fail,
                ),
            )
            result_rows.append(
                CalResultResponse(
                    id=cur.lastrowid,
                    calibration_id=cal_id,
                    parameter_name=item.parameter_name,
                    measured_value=item.measured_value,
                    limit_min=item.limit_min,
                    limit_max=item.limit_max,
                    unit=item.unit,
                    pass_fail=item.pass_fail,
                )
            )

        # Link equipment used during calibration
        for eq_id in cal_data.equipment_ids:
            await db.execute(
                """INSERT OR IGNORE INTO calibration_equipment
                   (calibration_id, equipment_id) VALUES (?, ?)""",
                (cal_id, eq_id),
            )

        await db.commit()

    await log_audit(
        user_id=current_user.id,
        action="create",
        entity_type="calibration",
        entity_id=cal_id,
        details=f"subsystem_id={cal_data.subsystem_id} cal_type={cal_data.cal_type} status={overall_status} equipment={cal_data.equipment_ids}",
    )

    return CalibrationResponse(
        id=cal_id,
        subsystem_id=cal_data.subsystem_id,
        performed_by=current_user.id,
        cal_type=cal_data.cal_type,
        ref_cable_sn=cal_data.ref_cable_sn,
        performed_at=performed_at_str,
        expires_at=expires_at_str,
        status=overall_status,
        results=result_rows,
    )


# ---------------------------------------------------------------------------
# GET /api/calibrations/parameters/{subsystem_id} — Calibration template
# (MUST be defined before /valid/{subsystem_id} so FastAPI matches it first)
# ---------------------------------------------------------------------------


class CalParameterItem(BaseModel):
    """A single calibration parameter definition."""

    name: str
    unit: str
    limit_type: str
    limit_min: Optional[float] = None
    limit_max: Optional[float] = None
    limit_nominal: Optional[float] = None
    limit_tolerance: Optional[float] = None


class CalParametersResponse(BaseModel):
    """Calibration parameter template for a subsystem."""

    subsystem_id: int
    drawing_no: str
    subsystem_name: str
    parameters: list[CalParameterItem]


@router.get(
    "/parameters/{subsystem_id}",
    response_model=CalParametersResponse,
    summary="Get calibration parameter template for a subsystem",
)
async def get_calibration_parameters(
    subsystem_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> CalParametersResponse:
    """Return the list of calibration measurements required for a subsystem.

    Used by the frontend to render the calibration entry form.
    """
    from seed_data import CALIBRATION_PARAMETERS

    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, drawing_no, name FROM subsystems WHERE id = ?",
            (subsystem_id,),
        )
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subsystem with id {subsystem_id} not found",
        )

    drawing_no = row["drawing_no"]
    param_defs = CALIBRATION_PARAMETERS.get(drawing_no, [])

    parameters = [
        CalParameterItem(
            name=p["name"],
            unit=p["unit"],
            limit_type=p["limit_type"],
            limit_min=p.get("limit_min"),
            limit_max=p.get("limit_max"),
            limit_nominal=p.get("limit_nominal"),
            limit_tolerance=p.get("limit_tolerance"),
        )
        for p in param_defs
    ]

    return CalParametersResponse(
        subsystem_id=subsystem_id,
        drawing_no=drawing_no,
        subsystem_name=row["name"],
        parameters=parameters,
    )


# ---------------------------------------------------------------------------
# GET /api/calibrations/valid/{subsystem_id} — Check for valid calibration
# ---------------------------------------------------------------------------

@router.get(
    "/valid/{subsystem_id}",
    response_model=ValidCalibrationResponse,
)
async def get_valid_calibration(
    subsystem_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> ValidCalibrationResponse:
    """Return the most recent valid (unexpired) calibration for a subsystem.

    Returns 404 if no valid calibration exists.  The response includes the
    time remaining until expiry in both seconds and a human-readable string.
    """
    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")

        # Verify subsystem exists
        cursor = await db.execute(
            "SELECT id FROM subsystems WHERE id = ?", (subsystem_id,)
        )
        if await cursor.fetchone() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subsystem with id {subsystem_id} not found",
            )

        # Find the most recent valid, unexpired calibration
        cursor = await db.execute(
            """
            SELECT *
              FROM calibrations
             WHERE subsystem_id = ?
               AND status = 'valid'
               AND expires_at > datetime('now')
             ORDER BY performed_at DESC
             LIMIT 1
            """,
            (subsystem_id,),
        )
        cal_row = await cursor.fetchone()

        if cal_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No valid calibration found for subsystem {subsystem_id}",
            )

        cal_id = cal_row["id"]

        # Fetch associated results
        cursor = await db.execute(
            "SELECT * FROM calibration_results WHERE calibration_id = ?",
            (cal_id,),
        )
        result_rows = await cursor.fetchall()

    # Calculate time remaining
    expires_at = datetime.strptime(cal_row["expires_at"], "%Y-%m-%d %H:%M:%S").replace(
        tzinfo=timezone.utc,
    )
    now = datetime.now(timezone.utc)
    remaining = expires_at - now
    remaining_seconds = max(remaining.total_seconds(), 0)

    # Human-readable remaining time
    hours, remainder = divmod(int(remaining_seconds), 3600)
    minutes, seconds = divmod(remainder, 60)
    human = f"{hours}h {minutes}m {seconds}s"

    results = [
        CalResultResponse(
            id=r["id"],
            calibration_id=r["calibration_id"],
            parameter_name=r["parameter_name"],
            measured_value=r["measured_value"],
            limit_min=r["limit_min"],
            limit_max=r["limit_max"],
            unit=r["unit"],
            pass_fail=r["pass_fail"],
        )
        for r in result_rows
    ]

    return ValidCalibrationResponse(
        id=cal_row["id"],
        subsystem_id=cal_row["subsystem_id"],
        performed_by=cal_row["performed_by"],
        cal_type=cal_row["cal_type"],
        ref_cable_sn=cal_row["ref_cable_sn"],
        performed_at=cal_row["performed_at"],
        expires_at=cal_row["expires_at"],
        status=cal_row["status"],
        time_remaining_seconds=remaining_seconds,
        time_remaining_human=human,
        results=results,
    )
