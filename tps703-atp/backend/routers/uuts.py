"""UUT (Unit Under Test) management router.

Provides endpoints for registering, listing, and querying units under test,
as well as retrieving test run history for a specific UUT.
"""

from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
from config import settings
from services.audit import log_audit

router = APIRouter(prefix="/api/uuts", tags=["uuts"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class UUTCreate(BaseModel):
    """Request body for registering a new Unit Under Test."""

    subsystem_id: int
    serial_number: str = Field(..., min_length=1, description="Serial number of the UUT")
    part_number: Optional[str] = None


class UUTResponse(BaseModel):
    """Response model for a single UUT record."""

    id: int
    subsystem_id: int
    serial_number: str
    part_number: Optional[str] = None
    status: str
    created_at: str


class UUTDetailResponse(UUTResponse):
    """Extended UUT response including subsystem information."""

    subsystem_drawing_no: Optional[str] = None
    subsystem_name: Optional[str] = None


class TestRunHistoryItem(BaseModel):
    """A single test run entry in a UUT's history."""

    id: int
    procedure_id: int
    procedure_code: Optional[str] = None
    procedure_name: Optional[str] = None
    started_by: int
    started_at: str
    completed_at: Optional[str] = None
    status: str
    execution_mode: Optional[str] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=UUTResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new UUT",
)
async def create_uut(
    uut_data: UUTCreate,
    current_user: UserInDB = Depends(require_role("technician")),
) -> UUTResponse:
    """Register a new Unit Under Test.

    Requires at least the **technician** role.  The combination of
    ``subsystem_id`` and ``serial_number`` must be unique.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")

        # Verify the referenced subsystem exists
        cursor = await db.execute(
            "SELECT id FROM subsystems WHERE id = ?", (uut_data.subsystem_id,)
        )
        if await cursor.fetchone() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subsystem with id {uut_data.subsystem_id} not found",
            )

        # Insert the UUT
        try:
            cursor = await db.execute(
                """
                INSERT INTO units_under_test (subsystem_id, serial_number, part_number)
                VALUES (?, ?, ?)
                """,
                (uut_data.subsystem_id, uut_data.serial_number, uut_data.part_number),
            )
            await db.commit()
            uut_id = cursor.lastrowid
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"UUT with serial_number '{uut_data.serial_number}' already exists for subsystem {uut_data.subsystem_id}",
            )

        # Fetch the newly created record to return consistent data
        cursor = await db.execute(
            "SELECT * FROM units_under_test WHERE id = ?", (uut_id,)
        )
        row = await cursor.fetchone()

    await log_audit(
        user_id=current_user.id,
        action="create",
        entity_type="uut",
        entity_id=uut_id,
        details=f"serial_number={uut_data.serial_number} subsystem_id={uut_data.subsystem_id}",
    )

    return UUTResponse(
        id=row["id"],
        subsystem_id=row["subsystem_id"],
        serial_number=row["serial_number"],
        part_number=row["part_number"],
        status=row["status"],
        created_at=row["created_at"],
    )


@router.get(
    "",
    response_model=list[UUTDetailResponse],
    summary="List all UUTs",
)
async def list_uuts(
    subsystem_id: Optional[int] = Query(None, description="Filter by subsystem ID"),
    current_user: UserInDB = Depends(get_current_user),
) -> list[UUTDetailResponse]:
    """Return all registered UUTs, optionally filtered by subsystem.

    Includes subsystem drawing number and name for convenience.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        base_query = """
            SELECT
                u.id,
                u.subsystem_id,
                u.serial_number,
                u.part_number,
                u.status,
                u.created_at,
                s.drawing_no AS subsystem_drawing_no,
                s.name       AS subsystem_name
            FROM units_under_test u
            LEFT JOIN subsystems s ON s.id = u.subsystem_id
        """

        if subsystem_id is not None:
            base_query += " WHERE u.subsystem_id = ?"
            cursor = await db.execute(base_query + " ORDER BY u.created_at DESC", (subsystem_id,))
        else:
            cursor = await db.execute(base_query + " ORDER BY u.created_at DESC")

        rows = await cursor.fetchall()

    return [
        UUTDetailResponse(
            id=row["id"],
            subsystem_id=row["subsystem_id"],
            serial_number=row["serial_number"],
            part_number=row["part_number"],
            status=row["status"],
            created_at=row["created_at"],
            subsystem_drawing_no=row["subsystem_drawing_no"],
            subsystem_name=row["subsystem_name"],
        )
        for row in rows
    ]


@router.get(
    "/{uut_id}",
    response_model=UUTDetailResponse,
    summary="Get UUT detail",
)
async def get_uut(
    uut_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> UUTDetailResponse:
    """Return a single UUT by ID, including subsystem information."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            """
            SELECT
                u.id,
                u.subsystem_id,
                u.serial_number,
                u.part_number,
                u.status,
                u.created_at,
                s.drawing_no AS subsystem_drawing_no,
                s.name       AS subsystem_name
            FROM units_under_test u
            LEFT JOIN subsystems s ON s.id = u.subsystem_id
            WHERE u.id = ?
            """,
            (uut_id,),
        )
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"UUT with id {uut_id} not found",
        )

    return UUTDetailResponse(
        id=row["id"],
        subsystem_id=row["subsystem_id"],
        serial_number=row["serial_number"],
        part_number=row["part_number"],
        status=row["status"],
        created_at=row["created_at"],
        subsystem_drawing_no=row["subsystem_drawing_no"],
        subsystem_name=row["subsystem_name"],
    )


@router.get(
    "/{uut_id}/history",
    response_model=list[TestRunHistoryItem],
    summary="Get test run history for a UUT",
)
async def get_uut_history(
    uut_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> list[TestRunHistoryItem]:
    """Return all test runs associated with a specific UUT, most recent first.

    Joins with ``test_procedures`` to include the procedure code and name.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # First verify the UUT exists
        cursor = await db.execute(
            "SELECT id FROM units_under_test WHERE id = ?", (uut_id,)
        )
        if await cursor.fetchone() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"UUT with id {uut_id} not found",
            )

        cursor = await db.execute(
            """
            SELECT
                tr.id,
                tr.procedure_id,
                tp.code  AS procedure_code,
                tp.name  AS procedure_name,
                tr.started_by,
                tr.started_at,
                tr.completed_at,
                tr.status,
                tr.execution_mode,
                tr.notes
            FROM test_runs tr
            LEFT JOIN test_procedures tp ON tp.id = tr.procedure_id
            WHERE tr.uut_id = ?
            ORDER BY tr.started_at DESC
            """,
            (uut_id,),
        )
        rows = await cursor.fetchall()

    return [
        TestRunHistoryItem(
            id=row["id"],
            procedure_id=row["procedure_id"],
            procedure_code=row["procedure_code"],
            procedure_name=row["procedure_name"],
            started_by=row["started_by"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            status=row["status"],
            execution_mode=row["execution_mode"],
            notes=row["notes"],
        )
        for row in rows
    ]
