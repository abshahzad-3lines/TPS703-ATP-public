"""Audit log query router — admin-only access to the append-only audit trail."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from auth.dependencies import require_role
from auth.models import UserInDB
import dbx
from config import settings

router = APIRouter(prefix="/api/audit", tags=["audit"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class AuditLogEntry(BaseModel):
    """A single audit log entry returned by the API."""

    id: int
    user_id: Optional[int] = None
    user_full_name: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    details: Optional[str] = None
    timestamp: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[AuditLogEntry],
    summary="List audit log entries",
)
async def list_audit_log(
    limit: int = Query(default=100, ge=1, le=1000, description="Max entries to return"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    action: Optional[str] = Query(None, description="Filter by action"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    since: Optional[str] = Query(None, description="Only entries on or after this ISO datetime"),
    until: Optional[str] = Query(None, description="Only entries on or before this ISO datetime"),
    current_user: UserInDB = Depends(require_role("admin")),
) -> list[AuditLogEntry]:
    """Return audit log entries ordered by timestamp descending.

    Requires the **admin** role.  Supports optional filters for
    ``entity_type``, ``action``, ``user_id``, and a date range
    (``since`` / ``until``).
    """
    conditions: list[str] = []
    params: list = []

    if entity_type is not None:
        conditions.append("a.entity_type = ?")
        params.append(entity_type)

    if action is not None:
        conditions.append("a.action = ?")
        params.append(action)

    if user_id is not None:
        conditions.append("a.user_id = ?")
        params.append(user_id)

    if since is not None:
        conditions.append("a.timestamp >= ?")
        params.append(since)

    if until is not None:
        conditions.append("a.timestamp <= ?")
        params.append(until)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    query = f"""
        SELECT
            a.id,
            a.user_id,
            u.full_name AS user_full_name,
            a.action,
            a.entity_type,
            a.entity_id,
            a.details,
            a.timestamp,
            -- Joined context for richer display
            tp.code       AS proc_code,
            tp.name       AS proc_name,
            s.drawing_no  AS subsystem_drawing,
            s.name        AS subsystem_name,
            uut.serial_number AS uut_serial,
            eq.name       AS equip_name,
            eq.model      AS equip_model,
            tr_run.status AS run_status
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        -- test_run context
        LEFT JOIN test_runs tr_run ON a.entity_type = 'test_run' AND tr_run.id = a.entity_id
        LEFT JOIN test_procedures tp ON tp.id = tr_run.procedure_id
        LEFT JOIN subsystems s ON s.id = tp.subsystem_id
        LEFT JOIN units_under_test uut ON uut.id = tr_run.uut_id
        -- equipment context
        LEFT JOIN equipment eq ON a.entity_type = 'equipment' AND eq.id = a.entity_id
        {where_clause}
        ORDER BY a.timestamp DESC
        LIMIT ?
    """
    params.append(limit)

    async with dbx.connect() as db:
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()

    results: list[AuditLogEntry] = []
    for row in rows:
        # Build a rich detail string from the joined data
        detail = row["details"] or ""

        if row["entity_type"] == "test_run" and row["proc_code"]:
            parts = []
            parts.append(f'{row["subsystem_drawing"]} / {row["proc_code"]}')
            if row["uut_serial"]:
                parts.append(f'SN: {row["uut_serial"]}')
            if row["run_status"] and row["action"] in ("complete", "abort"):
                parts.append(f'Status: {row["run_status"]}')
            if detail:
                parts.append(detail)
            detail = " | ".join(parts)
        elif row["entity_type"] == "equipment" and row["equip_name"]:
            parts = [row["equip_name"]]
            if row["equip_model"]:
                parts.append(row["equip_model"])
            if detail:
                parts.append(detail)
            detail = " | ".join(parts)
        elif row["entity_type"] == "user" and row["action"] == "login":
            # Enrich login entries with the user's full name
            name = row["user_full_name"] or "Unknown"
            detail = f"User '{name}' authenticated successfully"
        elif row["entity_type"] == "uut" and detail:
            # Parse serial_number from details
            detail = detail.replace("serial_number=", "SN: ").replace("subsystem_id=", "Subsystem #")

        results.append(
            AuditLogEntry(
                id=row["id"],
                user_id=row["user_id"],
                user_full_name=row["user_full_name"],
                action=row["action"],
                entity_type=row["entity_type"],
                entity_id=row["entity_id"],
                details=detail or None,
                timestamp=row["timestamp"],
            )
        )

    return results
