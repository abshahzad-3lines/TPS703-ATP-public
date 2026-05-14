"""Subsystem API router: list subsystems, get details, and procedures."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from auth.dependencies import get_current_user
from auth.models import UserInDB
from database import get_db_connection


router = APIRouter(
    prefix="/api/subsystems",
    tags=["subsystems"],
    dependencies=[Depends(get_current_user)],
)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class SubsystemSummary(BaseModel):
    """Subsystem with procedure count, returned in list endpoint."""

    id: int
    drawing_no: str
    name: str
    assembly_no: str | None = None
    revision: str | None = None
    description: str | None = None
    rf_band_start_mhz: float | None = None
    rf_band_stop_mhz: float | None = None
    nominal_output_dbm: float | None = None
    nominal_output_watts: float | None = None
    procedure_count: int


class ProcedureSummary(BaseModel):
    """Procedure with step count."""

    id: int
    subsystem_id: int
    code: str
    name: str
    section_ref: str | None = None
    sequence_order: int | None = None
    warmup_minutes: int | None = None
    default_pulse_width_us: float | None = None
    is_active: bool
    step_count: int
    requires_calibration: bool = False


class SubsystemDetail(BaseModel):
    """Full subsystem detail including its procedures."""

    id: int
    drawing_no: str
    name: str
    assembly_no: str | None = None
    revision: str | None = None
    description: str | None = None
    rf_band_start_mhz: float | None = None
    rf_band_stop_mhz: float | None = None
    nominal_output_dbm: float | None = None
    nominal_output_watts: float | None = None
    procedures: list[ProcedureSummary]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[SubsystemSummary])
async def list_subsystems() -> list[SubsystemSummary]:
    """Return all subsystem definitions with their procedure counts."""
    db = await get_db_connection()
    try:
        cursor = await db.execute(
            """
            SELECT s.*,
                   COUNT(tp.id) AS procedure_count
            FROM subsystems s
            LEFT JOIN test_procedures tp ON tp.subsystem_id = s.id
            GROUP BY s.id
            ORDER BY s.id
            """
        )
        rows = await cursor.fetchall()
        return [
            SubsystemSummary(
                id=row["id"],
                drawing_no=row["drawing_no"],
                name=row["name"],
                assembly_no=row["assembly_no"],
                revision=row["revision"],
                description=row["description"],
                rf_band_start_mhz=row["rf_band_start_mhz"],
                rf_band_stop_mhz=row["rf_band_stop_mhz"],
                nominal_output_dbm=row["nominal_output_dbm"],
                nominal_output_watts=row["nominal_output_watts"],
                procedure_count=row["procedure_count"],
            )
            for row in rows
        ]
    finally:
        await db.close()


@router.get("/{subsystem_id}", response_model=SubsystemDetail)
async def get_subsystem(subsystem_id: int) -> SubsystemDetail:
    """Return a single subsystem with its procedures (including step counts)."""
    db = await get_db_connection()
    try:
        # Fetch the subsystem
        cursor = await db.execute(
            "SELECT * FROM subsystems WHERE id = ?", (subsystem_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subsystem {subsystem_id} not found",
            )

        # Fetch its procedures with step counts
        proc_cursor = await db.execute(
            """
            SELECT tp.*,
                   COUNT(ts.id) AS step_count
            FROM test_procedures tp
            LEFT JOIN test_steps ts ON ts.procedure_id = tp.id
            WHERE tp.subsystem_id = ?
            GROUP BY tp.id
            ORDER BY tp.sequence_order
            """,
            (subsystem_id,),
        )
        proc_rows = await proc_cursor.fetchall()

        procedures = [
            ProcedureSummary(
                id=p["id"],
                subsystem_id=p["subsystem_id"],
                code=p["code"],
                name=p["name"],
                section_ref=p["section_ref"],
                sequence_order=p["sequence_order"],
                warmup_minutes=p["warmup_minutes"],
                default_pulse_width_us=p["default_pulse_width_us"],
                is_active=bool(p["is_active"]),
                step_count=p["step_count"],
                requires_calibration=bool(p["requires_calibration"]),
            )
            for p in proc_rows
        ]

        return SubsystemDetail(
            id=row["id"],
            drawing_no=row["drawing_no"],
            name=row["name"],
            assembly_no=row["assembly_no"],
            revision=row["revision"],
            description=row["description"],
            rf_band_start_mhz=row["rf_band_start_mhz"],
            rf_band_stop_mhz=row["rf_band_stop_mhz"],
            nominal_output_dbm=row["nominal_output_dbm"],
            nominal_output_watts=row["nominal_output_watts"],
            procedures=procedures,
        )
    finally:
        await db.close()


@router.get("/{subsystem_id}/procedures", response_model=list[ProcedureSummary])
async def list_procedures(subsystem_id: int) -> list[ProcedureSummary]:
    """Return procedures for a subsystem, each with its step count."""
    db = await get_db_connection()
    try:
        # Verify subsystem exists
        cursor = await db.execute(
            "SELECT id FROM subsystems WHERE id = ?", (subsystem_id,)
        )
        if await cursor.fetchone() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subsystem {subsystem_id} not found",
            )

        # Fetch procedures with step counts
        proc_cursor = await db.execute(
            """
            SELECT tp.*,
                   COUNT(ts.id) AS step_count
            FROM test_procedures tp
            LEFT JOIN test_steps ts ON ts.procedure_id = tp.id
            WHERE tp.subsystem_id = ?
            GROUP BY tp.id
            ORDER BY tp.sequence_order
            """,
            (subsystem_id,),
        )
        proc_rows = await proc_cursor.fetchall()

        return [
            ProcedureSummary(
                id=p["id"],
                subsystem_id=p["subsystem_id"],
                code=p["code"],
                name=p["name"],
                section_ref=p["section_ref"],
                sequence_order=p["sequence_order"],
                warmup_minutes=p["warmup_minutes"],
                default_pulse_width_us=p["default_pulse_width_us"],
                is_active=bool(p["is_active"]),
                step_count=p["step_count"],
                requires_calibration=bool(p["requires_calibration"]),
            )
            for p in proc_rows
        ]
    finally:
        await db.close()
