"""Audit logging service — append-only audit trail for all write operations."""

import asyncio
import logging

import aiosqlite

from config import settings

logger = logging.getLogger(__name__)


async def _write_audit_entry(
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    details: str | None = None,
) -> None:
    """Insert a single row into the audit_log table.

    This is the internal implementation that performs the actual DB write.
    Errors are logged but never propagated so audit logging cannot break
    the main request flow.
    """
    try:
        async with aiosqlite.connect(settings.DB_PATH) as db:
            await db.execute(
                """
                INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, action, entity_type, entity_id, details),
            )
            await db.commit()
    except Exception:
        logger.exception(
            "Failed to write audit log entry: action=%s entity_type=%s entity_id=%s",
            action,
            entity_type,
            entity_id,
        )


async def log_audit(
    user_id: int | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    details: str | None = None,
) -> None:
    """Record an audit log entry (fire-and-forget).

    The write is dispatched as a background task so it does not block the
    caller.  Any database errors are caught and logged — they never
    propagate to the main request handler.

    Args:
        user_id: ID of the user who performed the action (None for system).
        action: Verb describing the operation, e.g. ``create``, ``start``,
            ``pause``, ``resume``, ``abort``, ``complete``, ``sign``,
            ``login``, ``export``, ``update``, ``delete``.
        entity_type: Kind of entity affected, e.g. ``test_run``, ``uut``,
            ``calibration``, ``user``.
        entity_id: Primary key of the affected entity (optional).
        details: Free-form text with extra context (optional).
    """
    asyncio.create_task(
        _write_audit_entry(user_id, action, entity_type, entity_id, details)
    )
