"""ATP definition state machine — Phase 10.

States: draft → in_review → approved → published → superseded.

Rules:
- Author submits draft for review (``draft → in_review``).
- Any engineer (or admin) who is NOT the author can approve
  (``in_review → approved``) or reject back to draft (``in_review → draft``).
- An engineer/admin publishes an approved revision (``approved → published``).
  Publishing automatically marks any previously-published revision sharing
  the same ``code`` as ``superseded`` and links it forward via
  ``superseded_by_definition_id``.
- ``superseded`` is terminal.
- All transitions append an ``atp_state_transitions`` row and a global
  ``audit_log`` entry.
"""

from __future__ import annotations

import aiosqlite
from fastapi import HTTPException, status

from auth.models import UserInDB
from auth.dependencies import ROLE_HIERARCHY
from config import settings
from services.audit import log_audit


STATES = ("draft", "in_review", "approved", "published", "superseded")

# Allowed forward transitions
_ALLOWED: dict[str, set[str]] = {
    "draft": {"in_review"},
    "in_review": {"draft", "approved"},
    "approved": {"published", "draft"},   # allow correction (kicked back)
    "published": {"superseded"},
    "superseded": set(),
}


def _has_role(user: UserInDB, min_role: str) -> bool:
    return ROLE_HIERARCHY.index(user.role) >= ROLE_HIERARCHY.index(min_role)


async def _get_definition(db: aiosqlite.Connection, definition_id: int) -> aiosqlite.Row:
    cur = await db.execute(
        "SELECT * FROM atp_definitions WHERE id = ?", (definition_id,)
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ATP definition {definition_id} not found",
        )
    return row


def _assert_transition_allowed(from_state: str, to_state: str) -> None:
    if to_state not in _ALLOWED.get(from_state, set()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Illegal transition {from_state} → {to_state}",
        )


def _assert_role(user: UserInDB, min_role: str, action: str) -> None:
    if not _has_role(user, min_role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{user.role}' cannot {action}; requires '{min_role}' or higher.",
        )


async def transition(
    definition_id: int,
    to_state: str,
    user: UserInDB,
    *,
    comment: str | None = None,
    validator=None,
) -> dict:
    """Transition the definition to ``to_state``.

    ``validator`` is an optional callable ``(db, definition_id) -> list[str]``
    of blocking issues that must be empty for publish transitions. Wave 2b's
    step-schema validator is wired here when ``to_state in {'approved',
    'published'}``.
    """
    if to_state not in STATES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown state: {to_state}",
        )

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")

        row = await _get_definition(db, definition_id)
        from_state = row["state"]
        _assert_transition_allowed(from_state, to_state)

        # Per-transition role/identity rules
        if from_state == "draft" and to_state == "in_review":
            # The author (or anyone with technician+) can submit for review.
            _assert_role(user, "technician", "submit ATP for review")

        elif from_state == "in_review" and to_state == "approved":
            _assert_role(user, "engineer", "approve ATP")
            if row["created_by"] is not None and row["created_by"] == user.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Author cannot approve their own ATP.",
                )
            issues = await _run_validator(db, definition_id, validator)
            if issues:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"message": "ATP fails validation", "issues": issues},
                )

        elif from_state == "in_review" and to_state == "draft":
            _assert_role(user, "engineer", "reject ATP back to draft")

        elif from_state == "approved" and to_state == "published":
            _assert_role(user, "engineer", "publish ATP")
            issues = await _run_validator(db, definition_id, validator)
            if issues:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"message": "ATP fails validation", "issues": issues},
                )

        elif from_state == "approved" and to_state == "draft":
            _assert_role(user, "engineer", "kick ATP back to draft")

        elif from_state == "published" and to_state == "superseded":
            # Manual superseding is admin-only; automatic on publish is
            # handled below (and uses NULL user_id in the transition row).
            _assert_role(user, "admin", "supersede a published ATP manually")

        # Apply the transition
        now_clause = "datetime('now')"
        update_sets = ["state = ?", f"updated_at = {now_clause}"]
        update_vals: list = [to_state]

        if to_state == "published":
            update_sets += [f"published_at = {now_clause}", "published_by = ?"]
            update_vals.append(user.id)
        elif to_state == "superseded":
            update_sets.append(f"superseded_at = {now_clause}")

        await db.execute(
            f"UPDATE atp_definitions SET {', '.join(update_sets)} WHERE id = ?",
            (*update_vals, definition_id),
        )

        await db.execute(
            """
            INSERT INTO atp_state_transitions
                (definition_id, from_state, to_state, user_id, comment)
            VALUES (?, ?, ?, ?, ?)
            """,
            (definition_id, from_state, to_state, user.id, comment),
        )

        # On publish: supersede any sibling rows with same code already
        # in 'published' state.
        if to_state == "published":
            cur = await db.execute(
                """
                SELECT id FROM atp_definitions
                WHERE code = ? AND id != ? AND state = 'published'
                """,
                (row["code"], definition_id),
            )
            siblings = await cur.fetchall()
            for s in siblings:
                await db.execute(
                    f"""
                    UPDATE atp_definitions
                       SET state = 'superseded',
                           superseded_at = {now_clause},
                           superseded_by_definition_id = ?
                     WHERE id = ?
                    """,
                    (definition_id, s["id"]),
                )
                await db.execute(
                    """
                    INSERT INTO atp_state_transitions
                        (definition_id, from_state, to_state, user_id, comment)
                    VALUES (?, 'published', 'superseded', NULL,
                            'auto-superseded by new published revision')
                    """,
                    (s["id"],),
                )

        await db.commit()

    await log_audit(
        user.id,
        f"atp_{to_state}",
        "atp_definition",
        definition_id,
        comment or f"{from_state} → {to_state}",
    )

    return {
        "definition_id": definition_id,
        "from_state": from_state,
        "to_state": to_state,
    }


async def _run_validator(db, definition_id: int, validator) -> list[str]:
    if validator is None:
        return []
    return await validator(db, definition_id)


async def create_new_revision(
    source_definition_id: int,
    user: UserInDB,
    *,
    new_revision: str | None = None,
    notes: str | None = None,
) -> int:
    """Clone a published (or any) definition into a new draft revision.

    The new row's ``parent_definition_id`` points to the source; ``revision``
    auto-bumps (A → B → … → Z → AA) when ``new_revision`` is not given.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")

        src = await _get_definition(db, source_definition_id)

        if new_revision is None:
            # Find the highest revision letter for this code and bump it.
            cur = await db.execute(
                "SELECT revision FROM atp_definitions WHERE code = ? ORDER BY revision",
                (src["code"],),
            )
            existing = [r["revision"] for r in await cur.fetchall()]
            new_revision = _next_revision(existing)

        cur = await db.execute(
            """
            INSERT INTO atp_definitions (
                subsystem_id, legacy_procedure_id, code, revision, name,
                section_ref, sequence_order, warmup_minutes,
                default_pulse_width_us, requires_calibration,
                state, source, parent_definition_id, created_by, notes
            ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'authored', ?, ?, ?)
            """,
            (
                src["subsystem_id"],
                src["code"],
                new_revision,
                src["name"],
                src["section_ref"],
                src["sequence_order"],
                src["warmup_minutes"],
                src["default_pulse_width_us"],
                src["requires_calibration"],
                source_definition_id,
                user.id,
                notes,
            ),
        )
        new_id = cur.lastrowid

        # Copy steps
        step_cur = await db.execute(
            "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
            (source_definition_id,),
        )
        for s in await step_cur.fetchall():
            await db.execute(
                """
                INSERT INTO atp_steps (
                    definition_id, step_number, name, step_type, instrument,
                    frequency_mhz, input_power_dbm, pulse_width_us,
                    mux_address, mux_sample_time_us, bus_address, bus_data,
                    bus_rw, limit_type, limit_min, limit_max, limit_nominal,
                    limit_tolerance, unit, instructions, safety_warning,
                    is_optional, is_record_only
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id,
                    s["step_number"], s["name"], s["step_type"], s["instrument"],
                    s["frequency_mhz"], s["input_power_dbm"], s["pulse_width_us"],
                    s["mux_address"], s["mux_sample_time_us"], s["bus_address"],
                    s["bus_data"], s["bus_rw"], s["limit_type"], s["limit_min"],
                    s["limit_max"], s["limit_nominal"], s["limit_tolerance"],
                    s["unit"], s["instructions"], s["safety_warning"],
                    s["is_optional"], s["is_record_only"],
                ),
            )

        await db.execute(
            """
            INSERT INTO atp_state_transitions
                (definition_id, from_state, to_state, user_id, comment)
            VALUES (?, NULL, 'draft', ?, ?)
            """,
            (new_id, user.id, f"cloned from definition {source_definition_id} (rev {src['revision']})"),
        )

        await db.commit()

    await log_audit(
        user.id, "atp_revision_create", "atp_definition", new_id,
        f"cloned from {source_definition_id} → rev {new_revision}",
    )
    return new_id


def _next_revision(existing: list[str]) -> str:
    """Return the next revision letter not present in ``existing``."""
    used = {r.upper() for r in existing if r}
    # A, B, …, Z, AA, AB, …
    def gen():
        for c in range(65, 91):
            yield chr(c)
        for c1 in range(65, 91):
            for c2 in range(65, 91):
                yield chr(c1) + chr(c2)
    for candidate in gen():
        if candidate not in used:
            return candidate
    return "ZZ"
