"""Analytics API — KPI summary, daily trend, subsystem breakdown, top failures."""

from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from auth.dependencies import get_current_user
from auth.models import UserInDB
from config import settings

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------

class AnalyticsSummaryResponse(BaseModel):
    """KPI summary for the dashboard."""

    total_tests_30d: int
    total_tests_7d: int
    pass_rate_30d: float
    pass_rate_7d: float
    first_pass_yield: float
    active_subsystems: int
    pending_calibrations: int


class DailyTrendItem(BaseModel):
    """A single day in the daily-trend series."""

    date: str
    total: int
    passed: int
    failed: int
    pass_rate: float


class SubsystemBreakdownItem(BaseModel):
    """Per-subsystem pass/fail breakdown."""

    drawing_no: str
    name: str
    passed: int
    failed: int
    total: int
    pass_rate: float


class TopFailureItem(BaseModel):
    """A frequently-failing test step."""

    step_name: str
    procedure_code: str
    subsystem_name: str
    fail_count: int


# ---------------------------------------------------------------------------
# GET /api/analytics/summary
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=AnalyticsSummaryResponse)
async def get_analytics_summary(
    days: int = Query(default=30, ge=1, le=365),
    current_user: UserInDB = Depends(get_current_user),
) -> AnalyticsSummaryResponse:
    """Return KPI summary for the dashboard."""

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # 30-day stats
        cursor = await db.execute(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(CASE WHEN tr.status = 'passed' THEN 1 END) AS passed,
                COUNT(CASE WHEN tr.status = 'failed' THEN 1 END) AS failed
            FROM test_runs tr
            WHERE tr.status IN ('passed', 'failed', 'aborted')
              AND tr.started_at >= datetime('now', '-30 days')
            """
        )
        row_30d = await cursor.fetchone()
        total_30d = row_30d["total"] or 0
        passed_30d = row_30d["passed"] or 0
        failed_30d = row_30d["failed"] or 0

        # 7-day stats
        cursor = await db.execute(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(CASE WHEN tr.status = 'passed' THEN 1 END) AS passed,
                COUNT(CASE WHEN tr.status = 'failed' THEN 1 END) AS failed
            FROM test_runs tr
            WHERE tr.status IN ('passed', 'failed', 'aborted')
              AND tr.started_at >= datetime('now', '-7 days')
            """
        )
        row_7d = await cursor.fetchone()
        total_7d = row_7d["total"] or 0
        passed_7d = row_7d["passed"] or 0

        # Pass rates
        pass_rate_30d = (passed_30d / total_30d * 100) if total_30d > 0 else 0.0
        pass_rate_7d = (passed_7d / total_7d * 100) if total_7d > 0 else 0.0

        # First-pass yield: passed / (passed + failed) * 100  (excludes aborted)
        passed_total = passed_30d
        failed_total = failed_30d
        denominator = passed_total + failed_total
        first_pass_yield = (passed_total / denominator * 100) if denominator > 0 else 0.0

        # Active subsystems
        cursor = await db.execute("SELECT COUNT(*) AS cnt FROM subsystems")
        active_subsystems = (await cursor.fetchone())["cnt"] or 0

        # Pending calibrations — expiring within 2 hours or already expired
        cursor = await db.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM calibrations
            WHERE status = 'valid'
              AND expires_at <= datetime('now', '+2 hours')
            """
        )
        pending_calibrations = (await cursor.fetchone())["cnt"] or 0

    return AnalyticsSummaryResponse(
        total_tests_30d=total_30d,
        total_tests_7d=total_7d,
        pass_rate_30d=round(pass_rate_30d, 1),
        pass_rate_7d=round(pass_rate_7d, 1),
        first_pass_yield=round(first_pass_yield, 1),
        active_subsystems=active_subsystems,
        pending_calibrations=pending_calibrations,
    )


# ---------------------------------------------------------------------------
# GET /api/analytics/daily-trend
# ---------------------------------------------------------------------------

@router.get("/daily-trend", response_model=list[DailyTrendItem])
async def get_daily_trend(
    days: int = Query(default=30, ge=1, le=365),
    current_user: UserInDB = Depends(get_current_user),
) -> list[DailyTrendItem]:
    """Return daily pass/fail counts and pass rate."""

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            f"""
            SELECT
                DATE(tr.started_at) AS date,
                COUNT(*) AS total,
                COUNT(CASE WHEN tr.status = 'passed' THEN 1 END) AS passed,
                COUNT(CASE WHEN tr.status = 'failed' THEN 1 END) AS failed
            FROM test_runs tr
            WHERE tr.status IN ('passed', 'failed', 'aborted')
              AND tr.started_at >= datetime('now', '-{days} days')
            GROUP BY DATE(tr.started_at)
            ORDER BY DATE(tr.started_at)
            """
        )
        rows = await cursor.fetchall()

    items: list[DailyTrendItem] = []
    for r in rows:
        total = r["total"] or 0
        passed = r["passed"] or 0
        failed = r["failed"] or 0
        pass_rate = (passed / total * 100) if total > 0 else 0.0
        items.append(
            DailyTrendItem(
                date=r["date"],
                total=total,
                passed=passed,
                failed=failed,
                pass_rate=round(pass_rate, 1),
            )
        )

    return items


# ---------------------------------------------------------------------------
# GET /api/analytics/subsystem-breakdown
# ---------------------------------------------------------------------------

@router.get("/subsystem-breakdown", response_model=list[SubsystemBreakdownItem])
async def get_subsystem_breakdown(
    days: int = Query(default=30, ge=1, le=365),
    current_user: UserInDB = Depends(get_current_user),
) -> list[SubsystemBreakdownItem]:
    """Return per-subsystem pass/fail breakdown."""

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            f"""
            SELECT
                s.drawing_no,
                s.name,
                COUNT(*) AS total,
                COUNT(CASE WHEN tr.status = 'passed' THEN 1 END) AS passed,
                COUNT(CASE WHEN tr.status = 'failed' THEN 1 END) AS failed
            FROM test_runs tr
            JOIN test_procedures tp ON tr.procedure_id = tp.id
            JOIN subsystems s ON tp.subsystem_id = s.id
            WHERE tr.status IN ('passed', 'failed', 'aborted')
              AND tr.started_at >= datetime('now', '-{days} days')
            GROUP BY s.id, s.drawing_no, s.name
            ORDER BY s.drawing_no
            """
        )
        rows = await cursor.fetchall()

    items: list[SubsystemBreakdownItem] = []
    for r in rows:
        total = r["total"] or 0
        passed = r["passed"] or 0
        failed = r["failed"] or 0
        pass_rate = (passed / total * 100) if total > 0 else 0.0
        items.append(
            SubsystemBreakdownItem(
                drawing_no=r["drawing_no"],
                name=r["name"],
                passed=passed,
                failed=failed,
                total=total,
                pass_rate=round(pass_rate, 1),
            )
        )

    return items


# ---------------------------------------------------------------------------
# GET /api/analytics/top-failures
# ---------------------------------------------------------------------------

@router.get("/top-failures", response_model=list[TopFailureItem])
async def get_top_failures(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=10, ge=1, le=50),
    current_user: UserInDB = Depends(get_current_user),
) -> list[TopFailureItem]:
    """Return the most frequently-failing test steps."""

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            f"""
            SELECT
                ts.name AS step_name,
                tp.code AS procedure_code,
                s.name AS subsystem_name,
                COUNT(*) AS fail_count
            FROM test_results tres
            JOIN test_steps ts ON tres.step_id = ts.id
            JOIN test_runs tr ON tres.test_run_id = tr.id
            JOIN test_procedures tp ON tr.procedure_id = tp.id
            JOIN subsystems s ON tp.subsystem_id = s.id
            WHERE tres.pass_fail = 'fail'
              AND tr.started_at >= datetime('now', '-{days} days')
            GROUP BY ts.id, ts.name, tp.code, s.name
            ORDER BY fail_count DESC
            LIMIT {limit}
            """
        )
        rows = await cursor.fetchall()

    return [
        TopFailureItem(
            step_name=r["step_name"],
            procedure_code=r["procedure_code"],
            subsystem_name=r["subsystem_name"],
            fail_count=r["fail_count"],
        )
        for r in rows
    ]
