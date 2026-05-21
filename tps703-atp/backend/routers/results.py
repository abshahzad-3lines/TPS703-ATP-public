"""Results API router: list results, summaries, PDF certificate, and digital sign-off."""

import hashlib
import hmac
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
import dbx
from config import settings
from services.pdf_generator import generate_test_certificate


router = APIRouter(prefix="/api/results", tags=["results"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ResultListItem(BaseModel):
    """A single row in the results listing table."""

    id: int
    procedure_name: Optional[str] = None
    procedure_code: Optional[str] = None
    subsystem_name: Optional[str] = None
    drawing_no: Optional[str] = None
    serial_number: Optional[str] = None
    operator_name: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    status: str
    execution_mode: Optional[str] = None
    total_steps: int = 0
    passed_steps: int = 0
    failed_steps: int = 0


class ResultSummary(BaseModel):
    """Detailed summary for a single test run."""

    id: int
    procedure_name: Optional[str] = None
    procedure_code: Optional[str] = None
    subsystem_name: Optional[str] = None
    drawing_no: Optional[str] = None
    serial_number: Optional[str] = None
    operator_name: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    status: str
    execution_mode: Optional[str] = None
    total_steps: int = 0
    passed_steps: int = 0
    failed_steps: int = 0
    warning_steps: int = 0
    skipped_steps: int = 0
    verdict: str = "unknown"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[ResultListItem],
    summary="List completed test runs",
)
async def list_results(
    status_filter: Optional[str] = Query(
        default=None,
        alias="status",
        description="Filter by status: passed, failed, or aborted",
    ),
    subsystem_id: Optional[int] = Query(
        default=None,
        description="Filter by subsystem ID",
    ),
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of results to return",
    ),
    current_user: UserInDB = Depends(get_current_user),
) -> list[ResultListItem]:
    """Return completed test runs with joined procedure, subsystem, UUT,
    and operator information, plus per-run step pass/fail counts.
    """
    conditions: list[str] = []
    params: list[object] = []

    if status_filter:
        conditions.append("tr.status = ?")
        params.append(status_filter)
    else:
        conditions.append("tr.status IN ('passed', 'failed', 'aborted')")

    if subsystem_id is not None:
        conditions.append("tp.subsystem_id = ?")
        params.append(subsystem_id)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    params.append(limit)

    async with dbx.connect() as db:
        cursor = await db.execute(
            f"""
            SELECT
                tr.id,
                tp.name           AS procedure_name,
                tp.code           AS procedure_code,
                s.name            AS subsystem_name,
                s.drawing_no,
                uut.serial_number,
                u.full_name       AS operator_name,
                tr.started_at,
                tr.completed_at,
                tr.status,
                tr.execution_mode,
                (SELECT COUNT(*) FROM test_steps ts
                 WHERE ts.procedure_id = tr.procedure_id)      AS total_steps,
                (SELECT COUNT(*) FROM test_results trs
                 WHERE trs.test_run_id = tr.id
                   AND trs.pass_fail = 'pass')                 AS passed_steps,
                (SELECT COUNT(*) FROM test_results trs
                 WHERE trs.test_run_id = tr.id
                   AND trs.pass_fail = 'fail')                 AS failed_steps
            FROM test_runs tr
            LEFT JOIN test_procedures tp ON tp.id = tr.procedure_id
            LEFT JOIN subsystems s       ON s.id  = tp.subsystem_id
            LEFT JOIN units_under_test uut ON uut.id = tr.uut_id
            LEFT JOIN users u            ON u.id  = tr.started_by
            WHERE {where_clause}
            ORDER BY tr.completed_at DESC, tr.started_at DESC
            LIMIT ?
            """,
            tuple(params),
        )
        rows = await cursor.fetchall()

    return [
        ResultListItem(
            id=row["id"],
            procedure_name=row["procedure_name"],
            procedure_code=row["procedure_code"],
            subsystem_name=row["subsystem_name"],
            drawing_no=row["drawing_no"],
            serial_number=row["serial_number"],
            operator_name=row["operator_name"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            status=row["status"],
            execution_mode=row["execution_mode"],
            total_steps=row["total_steps"],
            passed_steps=row["passed_steps"],
            failed_steps=row["failed_steps"],
        )
        for row in rows
    ]


@router.get(
    "/{run_id}/summary",
    response_model=ResultSummary,
    summary="Get test run result summary",
)
async def get_result_summary(
    run_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> ResultSummary:
    """Return a detailed summary of a specific test run including step-level
    pass/fail/warning/skipped counts and an overall verdict.
    """
    async with dbx.connect() as db:

        cursor = await db.execute(
            """
            SELECT
                tr.id,
                tp.name           AS procedure_name,
                tp.code           AS procedure_code,
                s.name            AS subsystem_name,
                s.drawing_no,
                uut.serial_number,
                u.full_name       AS operator_name,
                tr.started_at,
                tr.completed_at,
                tr.status,
                tr.execution_mode
            FROM test_runs tr
            LEFT JOIN test_procedures tp ON tp.id = tr.procedure_id
            LEFT JOIN subsystems s       ON s.id  = tp.subsystem_id
            LEFT JOIN units_under_test uut ON uut.id = tr.uut_id
            LEFT JOIN users u            ON u.id  = tr.started_by
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

        cursor = await db.execute(
            """
            SELECT COUNT(*) AS cnt FROM test_steps
            WHERE procedure_id = (SELECT procedure_id FROM test_runs WHERE id = ?)
            """,
            (run_id,),
        )
        total_row = await cursor.fetchone()
        total_steps = total_row["cnt"] if total_row else 0

        cursor = await db.execute(
            """
            SELECT pass_fail, COUNT(*) AS cnt
            FROM test_results
            WHERE test_run_id = ?
            GROUP BY pass_fail
            """,
            (run_id,),
        )
        counts: dict[str, int] = {}
        for r in await cursor.fetchall():
            counts[r["pass_fail"]] = r["cnt"]

    passed = counts.get("pass", 0)
    failed = counts.get("fail", 0)
    warnings = counts.get("warning", 0)
    skipped = counts.get("skipped", 0)

    if run_row["status"] == "aborted":
        verdict = "aborted"
    elif failed > 0:
        verdict = "fail"
    elif warnings > 0:
        verdict = "conditional pass"
    elif passed > 0:
        verdict = "pass"
    else:
        verdict = "unknown"

    return ResultSummary(
        id=run_row["id"],
        procedure_name=run_row["procedure_name"],
        procedure_code=run_row["procedure_code"],
        subsystem_name=run_row["subsystem_name"],
        drawing_no=run_row["drawing_no"],
        serial_number=run_row["serial_number"],
        operator_name=run_row["operator_name"],
        started_at=run_row["started_at"],
        completed_at=run_row["completed_at"],
        status=run_row["status"],
        execution_mode=run_row["execution_mode"],
        total_steps=total_steps,
        passed_steps=passed,
        failed_steps=failed,
        warning_steps=warnings,
        skipped_steps=skipped,
        verdict=verdict,
    )


# ---------------------------------------------------------------------------
# PDF certificate download
# ---------------------------------------------------------------------------


@router.get(
    "/{run_id}/certificate",
    summary="Download PDF test certificate",
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "PDF test certificate file",
        },
        404: {"description": "Test run not found"},
    },
)
async def download_certificate(
    run_id: int,
    current_user: UserInDB = Depends(require_role("technician")),
) -> Response:
    """Generate and return a PDF test certificate for the given test run.

    Requires at least the **technician** role.
    """
    pdf_bytes = await generate_test_certificate(run_id)

    if pdf_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run {run_id} not found",
        )

    filename = f"ATP_Certificate_{run_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ---------------------------------------------------------------------------
# Digital sign-off
# ---------------------------------------------------------------------------


class SignOffResponse(BaseModel):
    """Response returned after signing a test run."""

    run_id: int
    signed_by: int
    signer_name: str
    signed_at: str
    signature_hash: str


class SignatureDetailResponse(BaseModel):
    """Response for retrieving signature details."""

    run_id: int
    signed_by: int
    signer_name: str
    signer_role: str
    signature_hash: str


@router.post(
    "/{run_id}/sign",
    response_model=SignOffResponse,
    summary="Engineer sign-off on a completed test run",
)
async def sign_test_run(
    run_id: int,
    current_user: UserInDB = Depends(require_role("engineer")),
) -> SignOffResponse:
    """Digitally sign a completed test run.

    Requires at least the **engineer** role. The run must be in a terminal
    state (passed or failed) and must not already be signed.
    """
    async with dbx.connect() as db:
        cursor = await db.execute(
            "SELECT * FROM test_runs WHERE id = ?", (run_id,)
        )
        run_row = await cursor.fetchone()

    if run_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run {run_id} not found",
        )

    if run_row["status"] not in ("passed", "failed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot sign run in '{run_row['status']}' state. Run must be passed or failed.",
        )

    if run_row["signed_by"] is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Test run has already been signed",
        )

    signed_at = datetime.now(timezone.utc).isoformat()
    message = (
        f"{run_id}:{run_row['status']}:{run_row['completed_at']}"
        f":{current_user.id}:{current_user.username}:{signed_at}"
    )
    signature_hash = hmac.new(
        settings.SECRET_KEY.encode(),
        message.encode(),
        hashlib.sha256,
    ).hexdigest()

    async with dbx.connect() as db:
        await db.execute(
            "UPDATE test_runs SET signed_by = ?, signature_hash = ? WHERE id = ?",
            (current_user.id, signature_hash, run_id),
        )
        await db.commit()

    return SignOffResponse(
        run_id=run_id,
        signed_by=current_user.id,
        signer_name=current_user.full_name,
        signed_at=signed_at,
        signature_hash=signature_hash,
    )


@router.get(
    "/{run_id}/signature",
    response_model=SignatureDetailResponse,
    summary="Get signature details for a test run",
)
async def get_signature(
    run_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> SignatureDetailResponse:
    """Return the digital signature details for a signed test run."""
    async with dbx.connect() as db:
        cursor = await db.execute(
            """
            SELECT tr.id, tr.signed_by, tr.signature_hash,
                   u.full_name AS signer_name, u.role AS signer_role
            FROM test_runs tr
            LEFT JOIN users u ON u.id = tr.signed_by
            WHERE tr.id = ?
            """,
            (run_id,),
        )
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run {run_id} not found",
        )

    if row["signed_by"] is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run {run_id} has not been signed",
        )

    return SignatureDetailResponse(
        run_id=row["id"],
        signed_by=row["signed_by"],
        signer_name=row["signer_name"],
        signer_role=row["signer_role"],
        signature_hash=row["signature_hash"],
    )
