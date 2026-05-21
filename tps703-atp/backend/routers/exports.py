"""Export API router: CSV (and future format) exports for test results."""

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from auth.dependencies import get_current_user
from auth.models import UserInDB
import dbx
from config import settings

router = APIRouter(prefix="/api/results", tags=["exports"])


@router.get(
    "/{run_id}/export/csv",
    summary="Export test results as CSV",
    response_class=Response,
    responses={
        200: {
            "content": {"text/csv": {}},
            "description": "CSV file with test results and metadata header",
        },
        404: {"description": "Test run not found"},
    },
)
async def export_results_csv(
    run_id: int,
    current_user: UserInDB = Depends(get_current_user),
) -> Response:
    """Export all test results for a given run as a downloadable CSV file.

    The file includes comment-prefixed metadata lines (run info, subsystem,
    operator, timestamps) followed by a standard CSV header row and one data
    row per recorded test result.

    Requires at least **viewer** role (any authenticated user).
    """
    async with dbx.connect() as db:

        # ------------------------------------------------------------------
        # 1. Fetch run metadata with joins
        # ------------------------------------------------------------------
        cursor = await db.execute(
            """
            SELECT
                tr.id            AS run_id,
                tr.started_at,
                tr.completed_at,
                tr.status,
                tr.execution_mode,
                tp.code          AS procedure_code,
                tp.name          AS procedure_name,
                s.drawing_no,
                s.name           AS subsystem_name,
                uut.serial_number,
                u.full_name      AS operator_name
            FROM test_runs tr
            JOIN test_procedures tp ON tp.id = tr.procedure_id
            JOIN subsystems s       ON s.id  = tp.subsystem_id
            JOIN units_under_test uut ON uut.id = tr.uut_id
            JOIN users u            ON u.id  = tr.started_by
            WHERE tr.id = ?
            """,
            (run_id,),
        )
        meta = await cursor.fetchone()

        if meta is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Test run {run_id} not found",
            )

        # ------------------------------------------------------------------
        # 2. Fetch result rows joined with step definitions
        # ------------------------------------------------------------------
        cursor = await db.execute(
            """
            SELECT
                ts.step_number,
                ts.name           AS step_name,
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
                r.measured_value,
                r.secondary_value,
                r.pass_fail,
                r.measured_at,
                r.integrity_hash
            FROM test_results r
            JOIN test_steps ts ON ts.id = r.step_id
            WHERE r.test_run_id = ?
            ORDER BY ts.step_number
            """,
            (run_id,),
        )
        rows = await cursor.fetchall()

    # ------------------------------------------------------------------
    # 3. Build CSV content
    # ------------------------------------------------------------------
    buf = io.StringIO()

    # Metadata comment header
    buf.write("# TPS-703 ATP Test Results Export\n")
    buf.write(f"# Run ID: {meta['run_id']}\n")
    buf.write(f"# Subsystem: {meta['drawing_no']} - {meta['subsystem_name']}\n")
    buf.write(f"# Procedure: {meta['procedure_code']} - {meta['procedure_name']}\n")
    buf.write(f"# Serial Number: {meta['serial_number']}\n")
    buf.write(f"# Operator: {meta['operator_name']}\n")
    buf.write(f"# Started: {meta['started_at']}\n")
    buf.write(f"# Completed: {meta['completed_at']}\n")
    buf.write(f"# Status: {meta['status']}\n")

    writer = csv.writer(buf)

    # Column header row
    writer.writerow([
        "Step Number",
        "Step Name",
        "Step Type",
        "Instrument",
        "Frequency (MHz)",
        "Input Power (dBm)",
        "Limit Type",
        "Limit Min",
        "Limit Max",
        "Limit Nominal",
        "Limit Tolerance",
        "Unit",
        "Measured Value",
        "Secondary Value",
        "Pass/Fail",
        "Measured At",
        "Integrity Hash",
    ])

    # Data rows
    for row in rows:
        writer.writerow([
            row["step_number"],
            row["step_name"],
            row["step_type"],
            row["instrument"],
            row["frequency_mhz"],
            row["input_power_dbm"],
            row["limit_type"],
            row["limit_min"],
            row["limit_max"],
            row["limit_nominal"],
            row["limit_tolerance"],
            row["unit"],
            row["measured_value"],
            row["secondary_value"],
            row["pass_fail"],
            row["measured_at"],
            row["integrity_hash"],
        ])

    csv_content = buf.getvalue()
    buf.close()

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="ATP_Results_{run_id}.csv"',
        },
    )
