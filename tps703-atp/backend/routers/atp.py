"""ATP authoring API — Phase 10.

Backs:
- list / detail / create-draft / clone / update / delete
- step CRUD + reorder
- state transitions (draft → in_review → approved → published → superseded)
- peer review (approvals)
- validation
- signed export / import bundle
- revision diff
- golden-unit simulation
"""

from __future__ import annotations

import json

import dbx
from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user, require_role
from auth.models import UserInDB
from database import get_db_connection
from services import (
    ai_atp,
    ai_groq,
    atp_bundle,
    atp_diff,
    atp_importer,
    atp_simulation,
    atp_state_machine,
    atp_validator,
    rate_limit,
)
from services.audit import log_audit


router = APIRouter(
    prefix="/api/atp",
    tags=["atp"],
    dependencies=[Depends(get_current_user)],
)


# ============================================================================
# Pydantic models
# ============================================================================


class StepIn(BaseModel):
    step_number: int = Field(ge=1)
    name: str
    step_type: str
    instrument: str | None = None
    frequency_mhz: float | None = None
    input_power_dbm: float | None = None
    pulse_width_us: float | None = None
    mux_address: str | None = None
    mux_sample_time_us: float | None = None
    bus_address: str | None = None
    bus_data: str | None = None
    bus_rw: str | None = None
    limit_type: str | None = None
    limit_min: float | None = None
    limit_max: float | None = None
    limit_nominal: float | None = None
    limit_tolerance: float | None = None
    unit: str | None = None
    instructions: str | None = None
    safety_warning: str | None = None
    is_optional: bool = False
    is_record_only: bool = False


class StepOut(StepIn):
    id: int


class DefinitionSummary(BaseModel):
    id: int
    subsystem_id: int
    code: str
    revision: str
    name: str
    section_ref: str | None = None
    sequence_order: int | None = None
    warmup_minutes: int | None = None
    state: str
    source: str
    parent_definition_id: int | None = None
    created_by: int | str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    published_at: str | None = None
    published_by: int | str | None = None
    superseded_at: str | None = None
    superseded_by_definition_id: int | None = None
    step_count: int = 0


class TransitionRow(BaseModel):
    id: int
    from_state: str | None
    to_state: str
    user_id: int | str | None
    comment: str | None
    transitioned_at: str


class ApprovalRow(BaseModel):
    id: int
    approver_id: int | str
    decision: str
    comment: str | None
    decided_at: str


class DefinitionDetail(DefinitionSummary):
    notes: str | None = None
    requires_calibration: bool = False
    default_pulse_width_us: float | None = None
    legacy_procedure_id: int | None = None
    steps: list[StepOut]
    transitions: list[TransitionRow]
    approvals: list[ApprovalRow]


class CreateDraftBody(BaseModel):
    subsystem_id: int
    code: str
    name: str
    revision: str = "A"
    section_ref: str | None = None
    sequence_order: int | None = None
    warmup_minutes: int = 0
    default_pulse_width_us: float | None = None
    requires_calibration: bool = False
    notes: str | None = None


class CloneBody(BaseModel):
    new_revision: str | None = None
    notes: str | None = None


class TransitionBody(BaseModel):
    to_state: str
    comment: str | None = None


class UpdateMetadataBody(BaseModel):
    name: str | None = None
    section_ref: str | None = None
    sequence_order: int | None = None
    warmup_minutes: int | None = None
    default_pulse_width_us: float | None = None
    requires_calibration: bool | None = None
    notes: str | None = None


class ReorderBody(BaseModel):
    step_ids: list[int]


class ApprovalBody(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    comment: str | None = None


# ============================================================================
# Helpers
# ============================================================================


def _row_to_step(row) -> StepOut:
    return StepOut(
        id=row["id"],
        step_number=row["step_number"],
        name=row["name"],
        step_type=row["step_type"],
        instrument=row["instrument"],
        frequency_mhz=row["frequency_mhz"],
        input_power_dbm=row["input_power_dbm"],
        pulse_width_us=row["pulse_width_us"],
        mux_address=row["mux_address"],
        mux_sample_time_us=row["mux_sample_time_us"],
        bus_address=row["bus_address"],
        bus_data=row["bus_data"],
        bus_rw=row["bus_rw"],
        limit_type=row["limit_type"],
        limit_min=row["limit_min"],
        limit_max=row["limit_max"],
        limit_nominal=row["limit_nominal"],
        limit_tolerance=row["limit_tolerance"],
        unit=row["unit"],
        instructions=row["instructions"],
        safety_warning=row["safety_warning"],
        is_optional=bool(row["is_optional"]),
        is_record_only=bool(row["is_record_only"]),
    )


def _row_to_summary(row, step_count: int) -> DefinitionSummary:
    return DefinitionSummary(
        id=row["id"],
        subsystem_id=row["subsystem_id"],
        code=row["code"],
        revision=row["revision"],
        name=row["name"],
        section_ref=row["section_ref"],
        sequence_order=row["sequence_order"],
        warmup_minutes=row["warmup_minutes"],
        state=row["state"],
        source=row["source"],
        parent_definition_id=row["parent_definition_id"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        published_at=row["published_at"],
        published_by=row["published_by"],
        superseded_at=row["superseded_at"],
        superseded_by_definition_id=row["superseded_by_definition_id"],
        step_count=step_count,
    )


async def _require_draft(db, definition_id: int):
    cur = await db.execute(
        "SELECT state FROM atp_definitions WHERE id = ?", (definition_id,)
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Definition not found")
    if row["state"] != "draft":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Definition is '{row['state']}' — only draft definitions are editable.",
        )


# ============================================================================
# Definitions
# ============================================================================


@router.get("/definitions", response_model=list[DefinitionSummary])
async def list_definitions(
    subsystem_id: int | None = None,
    state: str | None = None,
    code: str | None = None,
):
    """List ATP definitions with optional filters."""
    conditions = []
    params: list = []
    if subsystem_id is not None:
        conditions.append("ad.subsystem_id = ?")
        params.append(subsystem_id)
    if state is not None:
        conditions.append("ad.state = ?")
        params.append(state)
    if code is not None:
        conditions.append("ad.code = ?")
        params.append(code)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    db = await get_db_connection()
    try:
        cur = await db.execute(
            f"""
            SELECT ad.*, COUNT(s.id) AS step_count
            FROM atp_definitions ad
            LEFT JOIN atp_steps s ON s.definition_id = ad.id
            {where}
            GROUP BY ad.id
            ORDER BY ad.code, ad.revision DESC
            """,
            params,
        )
        rows = await cur.fetchall()
        return [_row_to_summary(r, r["step_count"]) for r in rows]
    finally:
        await db.close()


@router.get("/definitions/{definition_id}", response_model=DefinitionDetail)
async def get_definition(definition_id: int):
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT * FROM atp_definitions WHERE id = ?", (definition_id,)
        )
        defn = await cur.fetchone()
        if defn is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Definition not found")

        step_cur = await db.execute(
            "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
            (definition_id,),
        )
        steps = await step_cur.fetchall()

        trans_cur = await db.execute(
            "SELECT * FROM atp_state_transitions WHERE definition_id = ? "
            "ORDER BY id",
            (definition_id,),
        )
        transitions = await trans_cur.fetchall()

        appr_cur = await db.execute(
            "SELECT * FROM atp_approvals WHERE definition_id = ? ORDER BY id",
            (definition_id,),
        )
        approvals = await appr_cur.fetchall()

        return DefinitionDetail(
            id=defn["id"],
            subsystem_id=defn["subsystem_id"],
            code=defn["code"],
            revision=defn["revision"],
            name=defn["name"],
            section_ref=defn["section_ref"],
            sequence_order=defn["sequence_order"],
            warmup_minutes=defn["warmup_minutes"],
            state=defn["state"],
            source=defn["source"],
            parent_definition_id=defn["parent_definition_id"],
            created_by=defn["created_by"],
            created_at=defn["created_at"],
            updated_at=defn["updated_at"],
            published_at=defn["published_at"],
            published_by=defn["published_by"],
            superseded_at=defn["superseded_at"],
            superseded_by_definition_id=defn["superseded_by_definition_id"],
            step_count=len(steps),
            notes=defn["notes"],
            requires_calibration=bool(defn["requires_calibration"]),
            default_pulse_width_us=defn["default_pulse_width_us"],
            legacy_procedure_id=defn["legacy_procedure_id"],
            steps=[_row_to_step(s) for s in steps],
            transitions=[
                TransitionRow(
                    id=t["id"],
                    from_state=t["from_state"],
                    to_state=t["to_state"],
                    user_id=t["user_id"],
                    comment=t["comment"],
                    transitioned_at=t["transitioned_at"],
                )
                for t in transitions
            ],
            approvals=[
                ApprovalRow(
                    id=a["id"],
                    approver_id=a["approver_id"],
                    decision=a["decision"],
                    comment=a["comment"],
                    decided_at=a["decided_at"],
                )
                for a in approvals
            ],
        )
    finally:
        await db.close()


@router.post(
    "/definitions",
    response_model=DefinitionSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def create_draft(
    body: CreateDraftBody,
    user: UserInDB = Depends(get_current_user),
):
    """Create a brand-new draft ATP from scratch."""
    db = await get_db_connection()
    try:
        cur = await db.execute(
            """
            INSERT INTO atp_definitions (
                subsystem_id, code, revision, name, section_ref, sequence_order,
                warmup_minutes, default_pulse_width_us, requires_calibration,
                state, source, created_by, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'authored', ?, ?)
            """,
            (
                body.subsystem_id, body.code, body.revision, body.name,
                body.section_ref, body.sequence_order, body.warmup_minutes,
                body.default_pulse_width_us,
                1 if body.requires_calibration else 0,
                user.id, body.notes,
            ),
        )
        new_id = cur.lastrowid
        await db.execute(
            """
            INSERT INTO atp_state_transitions
                (definition_id, from_state, to_state, user_id, comment)
            VALUES (?, NULL, 'draft', ?, 'created from scratch')
            """,
            (new_id, user.id),
        )
        await db.commit()

        cur = await db.execute(
            "SELECT * FROM atp_definitions WHERE id = ?", (new_id,)
        )
        row = await cur.fetchone()
        await log_audit(user.id, "atp_draft_create", "atp_definition", new_id, body.code)
        return _row_to_summary(row, 0)
    finally:
        await db.close()


@router.post(
    "/definitions/{definition_id}/clone",
    response_model=DefinitionSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def clone_definition(
    definition_id: int,
    body: CloneBody = Body(default=CloneBody()),
    user: UserInDB = Depends(get_current_user),
):
    new_id = await atp_state_machine.create_new_revision(
        definition_id, user, new_revision=body.new_revision, notes=body.notes,
    )
    db = await get_db_connection()
    try:
        cur = await db.execute(
            """
            SELECT ad.*, COUNT(s.id) AS step_count
            FROM atp_definitions ad
            LEFT JOIN atp_steps s ON s.definition_id = ad.id
            WHERE ad.id = ?
            GROUP BY ad.id
            """,
            (new_id,),
        )
        row = await cur.fetchone()
        return _row_to_summary(row, row["step_count"])
    finally:
        await db.close()


@router.patch(
    "/definitions/{definition_id}",
    response_model=DefinitionSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def update_metadata(
    definition_id: int,
    body: UpdateMetadataBody,
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        await _require_draft(db, definition_id)
        sets = []
        vals = []
        for col in (
            "name", "section_ref", "sequence_order", "warmup_minutes",
            "default_pulse_width_us", "notes",
        ):
            v = getattr(body, col)
            if v is not None:
                sets.append(f"{col} = ?")
                vals.append(v)
        if body.requires_calibration is not None:
            sets.append("requires_calibration = ?")
            vals.append(1 if body.requires_calibration else 0)
        if sets:
            sets.append("updated_at = datetime('now')")
            vals.append(definition_id)
            await db.execute(
                f"UPDATE atp_definitions SET {', '.join(sets)} WHERE id = ?",
                vals,
            )
            await db.commit()

        cur = await db.execute(
            """
            SELECT ad.*, COUNT(s.id) AS step_count
            FROM atp_definitions ad
            LEFT JOIN atp_steps s ON s.definition_id = ad.id
            WHERE ad.id = ?
            GROUP BY ad.id
            """,
            (definition_id,),
        )
        row = await cur.fetchone()
        await log_audit(
            user.id, "atp_update", "atp_definition", definition_id,
            f"updated {len(sets) - 1} field(s)",
        )
        return _row_to_summary(row, row["step_count"])
    finally:
        await db.close()


@router.delete(
    "/definitions/{definition_id}",
    dependencies=[Depends(require_role("engineer"))],
)
async def delete_definition(
    definition_id: int,
    user: UserInDB = Depends(get_current_user),
):
    """Delete a draft definition. Non-draft revisions cannot be deleted."""
    db = await get_db_connection()
    try:
        await _require_draft(db, definition_id)
        await db.execute(
            "DELETE FROM atp_definitions WHERE id = ?", (definition_id,)
        )
        await db.commit()
        await log_audit(user.id, "atp_delete", "atp_definition", definition_id)
        return {"deleted": definition_id}
    finally:
        await db.close()


# ============================================================================
# Steps
# ============================================================================


@router.post(
    "/definitions/{definition_id}/steps",
    response_model=StepOut,
    dependencies=[Depends(require_role("engineer"))],
)
async def add_step(
    definition_id: int,
    body: StepIn,
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        await _require_draft(db, definition_id)
        try:
            cur = await db.execute(
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
                    definition_id, body.step_number, body.name, body.step_type,
                    body.instrument, body.frequency_mhz, body.input_power_dbm,
                    body.pulse_width_us, body.mux_address, body.mux_sample_time_us,
                    body.bus_address, body.bus_data, body.bus_rw, body.limit_type,
                    body.limit_min, body.limit_max, body.limit_nominal,
                    body.limit_tolerance, body.unit, body.instructions,
                    body.safety_warning,
                    1 if body.is_optional else 0,
                    1 if body.is_record_only else 0,
                ),
            )
        except dbx.IntegrityError as e:
            raise HTTPException(status.HTTP_409_CONFLICT, str(e))

        new_id = cur.lastrowid
        await db.execute(
            "UPDATE atp_definitions SET updated_at = datetime('now') WHERE id = ?",
            (definition_id,),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM atp_steps WHERE id = ?", (new_id,))
        row = await cur.fetchone()
        await log_audit(
            user.id, "atp_step_add", "atp_step", new_id,
            f"def={definition_id} #{body.step_number}",
        )
        return _row_to_step(row)
    finally:
        await db.close()


@router.patch(
    "/definitions/{definition_id}/steps/{step_id}",
    response_model=StepOut,
    dependencies=[Depends(require_role("engineer"))],
)
async def update_step(
    definition_id: int,
    step_id: int,
    body: StepIn,
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        await _require_draft(db, definition_id)
        cur = await db.execute(
            "SELECT id FROM atp_steps WHERE id = ? AND definition_id = ?",
            (step_id, definition_id),
        )
        if not await cur.fetchone():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Step not found")

        await db.execute(
            """
            UPDATE atp_steps SET
                step_number = ?, name = ?, step_type = ?, instrument = ?,
                frequency_mhz = ?, input_power_dbm = ?, pulse_width_us = ?,
                mux_address = ?, mux_sample_time_us = ?, bus_address = ?,
                bus_data = ?, bus_rw = ?, limit_type = ?, limit_min = ?,
                limit_max = ?, limit_nominal = ?, limit_tolerance = ?,
                unit = ?, instructions = ?, safety_warning = ?,
                is_optional = ?, is_record_only = ?
            WHERE id = ?
            """,
            (
                body.step_number, body.name, body.step_type, body.instrument,
                body.frequency_mhz, body.input_power_dbm, body.pulse_width_us,
                body.mux_address, body.mux_sample_time_us, body.bus_address,
                body.bus_data, body.bus_rw, body.limit_type, body.limit_min,
                body.limit_max, body.limit_nominal, body.limit_tolerance,
                body.unit, body.instructions, body.safety_warning,
                1 if body.is_optional else 0,
                1 if body.is_record_only else 0,
                step_id,
            ),
        )
        await db.execute(
            "UPDATE atp_definitions SET updated_at = datetime('now') WHERE id = ?",
            (definition_id,),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM atp_steps WHERE id = ?", (step_id,))
        row = await cur.fetchone()
        await log_audit(user.id, "atp_step_update", "atp_step", step_id)
        return _row_to_step(row)
    finally:
        await db.close()


@router.delete(
    "/definitions/{definition_id}/steps/{step_id}",
    dependencies=[Depends(require_role("engineer"))],
)
async def delete_step(
    definition_id: int,
    step_id: int,
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        await _require_draft(db, definition_id)
        await db.execute(
            "DELETE FROM atp_steps WHERE id = ? AND definition_id = ?",
            (step_id, definition_id),
        )
        await db.execute(
            "UPDATE atp_definitions SET updated_at = datetime('now') WHERE id = ?",
            (definition_id,),
        )
        await db.commit()
        await log_audit(user.id, "atp_step_delete", "atp_step", step_id)
        return {"deleted": step_id}
    finally:
        await db.close()


@router.post(
    "/definitions/{definition_id}/steps/reorder",
    dependencies=[Depends(require_role("engineer"))],
)
async def reorder_steps(
    definition_id: int,
    body: ReorderBody,
    user: UserInDB = Depends(get_current_user),
):
    """Re-number steps according to the order of ``step_ids``.

    The first id becomes step_number 1, etc.  All step_ids in the list must
    belong to this definition, and the list must cover every step exactly
    once (no partial reorders).
    """
    db = await get_db_connection()
    try:
        await _require_draft(db, definition_id)
        cur = await db.execute(
            "SELECT id FROM atp_steps WHERE definition_id = ?", (definition_id,)
        )
        existing = {r["id"] for r in await cur.fetchall()}
        if set(body.step_ids) != existing:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "step_ids must list every step in the definition exactly once.",
            )
        # Two-phase update to avoid UNIQUE(definition_id, step_number) collisions.
        for idx, sid in enumerate(body.step_ids, start=1):
            await db.execute(
                "UPDATE atp_steps SET step_number = ? WHERE id = ?",
                (-idx, sid),
            )
        for idx, sid in enumerate(body.step_ids, start=1):
            await db.execute(
                "UPDATE atp_steps SET step_number = ? WHERE id = ?",
                (idx, sid),
            )
        await db.execute(
            "UPDATE atp_definitions SET updated_at = datetime('now') WHERE id = ?",
            (definition_id,),
        )
        await db.commit()
        await log_audit(
            user.id, "atp_step_reorder", "atp_definition", definition_id,
            f"new order: {body.step_ids}",
        )
        return {"reordered": len(body.step_ids)}
    finally:
        await db.close()


# ============================================================================
# State machine + validation
# ============================================================================


@router.post(
    "/definitions/{definition_id}/transition",
    dependencies=[Depends(require_role("technician"))],
)
async def transition(
    definition_id: int,
    body: TransitionBody,
    user: UserInDB = Depends(get_current_user),
):
    return await atp_state_machine.transition(
        definition_id,
        body.to_state,
        user,
        comment=body.comment,
        validator=atp_validator.validate_for_publish,
    )


@router.get("/definitions/{definition_id}/validate")
async def validate(definition_id: int):
    db = await get_db_connection()
    try:
        issues = await atp_validator.validate_definition(db, definition_id)
        return {"issues": issues, "valid": not issues}
    finally:
        await db.close()


# ============================================================================
# Approvals (Wave 4a)
# ============================================================================


@router.post(
    "/definitions/{definition_id}/approvals",
    response_model=ApprovalRow,
    dependencies=[Depends(require_role("engineer"))],
)
async def submit_approval(
    definition_id: int,
    body: ApprovalBody,
    user: UserInDB = Depends(get_current_user),
):
    """Record an engineer's approval / rejection decision.

    A single ``approve`` from any engineer who is NOT the author auto-advances
    the definition state from ``in_review`` to ``approved``. A ``reject``
    sends it back to ``draft``.
    """
    # 1. Pre-flight (no DB writes yet)
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT state, created_by FROM atp_definitions WHERE id = ?",
            (definition_id,),
        )
        defn = await cur.fetchone()
        if defn is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Definition not found")
        if defn["state"] != "in_review":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Definition is '{defn['state']}', not 'in_review'.",
            )
        if defn["created_by"] is not None and defn["created_by"] == user.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Author cannot approve or reject their own ATP. Use /transition to withdraw.",
            )
        # Compute the current review round (count of in_review transitions).
        cur = await db.execute(
            """
            SELECT COUNT(*) AS c FROM atp_state_transitions
            WHERE definition_id = ? AND to_state = 'in_review'
            """,
            (definition_id,),
        )
        review_round = (await cur.fetchone())["c"] or 1

        cur = await db.execute(
            """
            SELECT id FROM atp_approvals
            WHERE definition_id = ? AND approver_id = ? AND review_round = ?
            """,
            (definition_id, user.id, review_round),
        )
        if await cur.fetchone():
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "You have already voted on this review round.",
            )
    finally:
        await db.close()

    # 2. Apply state transition first. If it fails (e.g. validation block on
    #    'approve'), no approval row is written.
    if body.decision == "approve":
        await atp_state_machine.transition(
            definition_id, "approved", user,
            comment=body.comment or "peer-review approval",
            validator=atp_validator.validate_for_publish,
        )
    else:
        await atp_state_machine.transition(
            definition_id, "draft", user,
            comment=body.comment or "peer-review rejection",
        )

    # 3. Record the approval decision (only on success).
    db = await get_db_connection()
    try:
        cur = await db.execute(
            """
            INSERT INTO atp_approvals
                (definition_id, approver_id, review_round, decision, comment)
            VALUES (?, ?, ?, ?, ?)
            """,
            (definition_id, user.id, review_round, body.decision, body.comment),
        )
        new_id = cur.lastrowid
        await db.commit()
        cur = await db.execute("SELECT * FROM atp_approvals WHERE id = ?", (new_id,))
        row = await cur.fetchone()
    finally:
        await db.close()

    return ApprovalRow(
        id=row["id"],
        approver_id=row["approver_id"],
        decision=row["decision"],
        comment=row["comment"],
        decided_at=row["decided_at"],
    )


# ============================================================================
# Export / Import bundles
# ============================================================================


@router.get("/definitions/{definition_id}/export")
async def export_definition(
    definition_id: int,
    user: UserInDB = Depends(get_current_user),
):
    """Stream the definition as a signed JSON bundle."""
    db = await get_db_connection()
    try:
        bundle = await atp_bundle.export_bundle(db, definition_id, user)
    finally:
        await db.close()

    await log_audit(user.id, "atp_export", "atp_definition", definition_id)
    body = json.dumps(bundle, indent=2).encode("utf-8")

    async def gen():
        yield body

    filename = f"atp-{bundle['definition']['code']}-rev{bundle['definition']['revision']}.json"
    return StreamingResponse(
        gen(),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============================================================================
# Document import (DOCX / PDF) — Wave 3b
# ============================================================================


class ImportPreviewOut(BaseModel):
    import_id: int
    filename: str
    source_type: str
    text_preview: str
    guessed_metadata: dict
    heuristic_steps: list[dict]
    status: str


class FinaliseImportBody(BaseModel):
    subsystem_id: int
    code: str
    name: str
    revision: str = "A"
    section_ref: str | None = None
    use_heuristic_steps: bool = True


@router.post(
    "/imports/upload",
    response_model=ImportPreviewOut,
    dependencies=[Depends(require_role("engineer"))],
)
async def upload_import(
    file: UploadFile = File(...),
    user: UserInDB = Depends(get_current_user),
):
    """Upload a customer-supplied .docx or .pdf, extract text, return a
    preview + heuristic step split. No ATP draft is created yet — the
    caller follows up with ``/imports/{id}/finalize``.
    """
    data = await file.read()
    name = (file.filename or "").lower()
    if name.endswith(".docx"):
        source_type = "docx"
    elif name.endswith(".pdf"):
        source_type = "pdf"
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Only .docx and .pdf are supported.",
        )

    try:
        if source_type == "docx":
            text = atp_importer.extract_text_from_docx(data)
        else:
            text = atp_importer.extract_text_from_pdf(data)
        extraction_status = "extracted"
        extraction_error: str | None = None
    except Exception as e:  # noqa: BLE001
        text = ""
        extraction_status = "failed"
        extraction_error = str(e)

    guessed = atp_importer.guess_metadata(text) if text else {}
    heuristic_steps = atp_importer.heuristic_extract_steps(text) if text else []

    db = await get_db_connection()
    try:
        cur = await db.execute(
            """
            INSERT INTO atp_imports
                (filename, mime_type, file_size, source_type, uploaded_by,
                 extracted_text, extraction_status, extraction_error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file.filename, file.content_type, len(data), source_type,
                user.id, text, extraction_status, extraction_error,
            ),
        )
        import_id = cur.lastrowid
        await db.commit()
    finally:
        await db.close()

    await log_audit(
        user.id, "atp_import_upload", "atp_import", import_id,
        f"{source_type}: {file.filename} ({len(data)} bytes)",
    )

    return ImportPreviewOut(
        import_id=import_id,
        filename=file.filename or "",
        source_type=source_type,
        text_preview=text[:2000] + ("…" if len(text) > 2000 else ""),
        guessed_metadata=guessed,
        heuristic_steps=heuristic_steps,
        status=extraction_status,
    )


@router.post(
    "/imports/{import_id}/finalize",
    response_model=DefinitionSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def finalize_import(
    import_id: int,
    body: FinaliseImportBody,
    user: UserInDB = Depends(get_current_user),
):
    """Materialize an upload into a draft ATP. Optionally populates steps
    from the heuristic split done at upload time.
    """
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT * FROM atp_imports WHERE id = ?", (import_id,)
        )
        imp = await cur.fetchone()
        if imp is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "import not found")
        if imp["extraction_status"] != "extracted":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"import is in status '{imp['extraction_status']}'; cannot finalize.",
            )

        source_marker = "imported_docx" if imp["source_type"] == "docx" else "imported_pdf"
        cur = await db.execute(
            """
            INSERT INTO atp_definitions (
                subsystem_id, code, revision, name, section_ref,
                state, source, created_by, notes
            ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
            """,
            (
                body.subsystem_id, body.code, body.revision, body.name,
                body.section_ref, source_marker, user.id,
                f"Imported from {imp['filename']} (import #{import_id})",
            ),
        )
        new_def_id = cur.lastrowid

        if body.use_heuristic_steps:
            steps = atp_importer.heuristic_extract_steps(imp["extracted_text"] or "")
            for s in steps:
                await db.execute(
                    """
                    INSERT INTO atp_steps
                        (definition_id, step_number, name, step_type, instructions)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (new_def_id, s["step_number"], s["name"], s["step_type"], s.get("instructions")),
                )

        await db.execute(
            """
            INSERT INTO atp_state_transitions
                (definition_id, from_state, to_state, user_id, comment)
            VALUES (?, NULL, 'draft', ?, ?)
            """,
            (new_def_id, user.id, f"finalized from import #{import_id}"),
        )
        await db.execute(
            "UPDATE atp_imports SET definition_id = ?, extraction_status = 'linked' WHERE id = ?",
            (new_def_id, import_id),
        )
        await db.commit()

        cur = await db.execute(
            """
            SELECT ad.*, COUNT(s.id) AS step_count
            FROM atp_definitions ad
            LEFT JOIN atp_steps s ON s.definition_id = ad.id
            WHERE ad.id = ?
            GROUP BY ad.id
            """,
            (new_def_id,),
        )
        row = await cur.fetchone()
        await log_audit(
            user.id, "atp_import_finalize", "atp_definition", new_def_id,
            f"from import #{import_id}",
        )
        return _row_to_summary(row, row["step_count"])
    finally:
        await db.close()


@router.get("/imports/{import_id}/text")
async def get_import_text(import_id: int):
    """Return the full extracted text of an upload (used by the AI extractor)."""
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT id, filename, source_type, extracted_text, definition_id, "
            "extraction_status FROM atp_imports WHERE id = ?",
            (import_id,),
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "import not found")
        return {
            "id": row["id"],
            "filename": row["filename"],
            "source_type": row["source_type"],
            "definition_id": row["definition_id"],
            "extraction_status": row["extraction_status"],
            "text": row["extracted_text"] or "",
        }
    finally:
        await db.close()


# ============================================================================
# Revision diff — Wave 4b
# ============================================================================


@router.get("/definitions/{base_id}/diff/{target_id}")
async def diff_revisions(base_id: int, target_id: int):
    db = await get_db_connection()
    try:
        try:
            return await atp_diff.diff_definitions(db, base_id, target_id)
        except ValueError as e:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    finally:
        await db.close()


# ============================================================================
# Golden-unit simulation — Wave 4c
# ============================================================================


@router.post(
    "/definitions/{definition_id}/simulate",
    dependencies=[Depends(require_role("engineer"))],
)
async def simulate(
    definition_id: int,
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        try:
            summary = await atp_simulation.simulate_definition(db, definition_id, user)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
        await log_audit(
            user.id, "atp_simulate", "atp_definition", definition_id,
            f"pass={summary['pass_count']} fail={summary['fail_count']} skip={summary['skipped_count']}",
        )
        return summary
    finally:
        await db.close()


@router.get("/definitions/{definition_id}/simulations")
async def list_simulations(definition_id: int):
    db = await get_db_connection()
    try:
        cur = await db.execute(
            """
            SELECT id, pass_count, fail_count, skipped_count, simulated_at,
                   simulated_by
            FROM atp_simulations
            WHERE definition_id = ?
            ORDER BY id DESC
            """,
            (definition_id,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ============================================================================
# AI features (Groq) — Wave 5
# ============================================================================


class AIExtractBody(BaseModel):
    """Body for ai-extract: either reference an import_id or send text inline."""
    import_id: int | None = None
    text: str | None = None
    subsystem_id: int
    code: str
    name: str
    revision: str = "A"
    replace_existing_steps: bool = False
    # When ``import_id`` is given AND ``definition_id`` is null, a new draft
    # is created. When ``definition_id`` is given, steps are added to it
    # (or replace its steps when ``replace_existing_steps`` is True).
    definition_id: int | None = None


def _ai_error_to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, ai_groq.GroqNotConfigured):
        return HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI feature requires XAI_API_KEY in the backend environment.",
        )
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Groq error: {exc}")


@router.post(
    "/ai/extract-from-document",
    response_model=DefinitionSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_extract_from_document(
    body: AIExtractBody,
    user: UserInDB = Depends(get_current_user),
):
    """AI-extract structured steps from an uploaded document (or inline
    text) and persist them as a new draft (or append to an existing draft).
    """
    rate_limit.check_and_record(user)
    text = body.text
    db = await get_db_connection()
    try:
        if body.import_id and not text:
            cur = await db.execute(
                "SELECT extracted_text FROM atp_imports WHERE id = ?",
                (body.import_id,),
            )
            row = await cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "import not found")
            text = row["extracted_text"] or ""
        if not text:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Either import_id (with extracted text) or 'text' must be provided.",
            )

        try:
            steps = await ai_atp.extract_steps_from_text(text)
        except Exception as e:  # noqa: BLE001
            raise _ai_error_to_http(e)

        if body.definition_id:
            # Append (or replace) steps on existing draft
            await _require_draft(db, body.definition_id)
            def_id = body.definition_id
            if body.replace_existing_steps:
                await db.execute(
                    "DELETE FROM atp_steps WHERE definition_id = ?", (def_id,)
                )
                start_num = 1
            else:
                cur = await db.execute(
                    "SELECT COALESCE(MAX(step_number), 0) AS m FROM atp_steps "
                    "WHERE definition_id = ?",
                    (def_id,),
                )
                start_num = (await cur.fetchone())["m"] + 1
        else:
            # Create new draft
            cur = await db.execute(
                """
                INSERT INTO atp_definitions
                    (subsystem_id, code, revision, name, state, source,
                     created_by, notes)
                VALUES (?, ?, ?, ?, 'draft', 'ai_extracted', ?, ?)
                """,
                (
                    body.subsystem_id, body.code, body.revision, body.name,
                    user.id,
                    f"AI-extracted from import #{body.import_id}"
                    if body.import_id else "AI-extracted from inline text",
                ),
            )
            def_id = cur.lastrowid
            await db.execute(
                """
                INSERT INTO atp_state_transitions
                    (definition_id, from_state, to_state, user_id, comment)
                VALUES (?, NULL, 'draft', ?, 'AI extract')
                """,
                (def_id, user.id),
            )
            start_num = 1

        # Persist steps (re-numbered against start_num)
        for offset, s in enumerate(steps):
            await db.execute(
                """
                INSERT INTO atp_steps (
                    definition_id, step_number, name, step_type, instrument,
                    frequency_mhz, input_power_dbm, pulse_width_us,
                    limit_min, limit_max, limit_nominal, limit_tolerance,
                    unit, instructions, safety_warning
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    def_id, start_num + offset,
                    s.get("name") or f"Step {start_num + offset}",
                    s.get("step_type") or "manual_record",
                    s.get("instrument"),
                    s.get("frequency_mhz"),
                    s.get("input_power_dbm"),
                    s.get("pulse_width_us"),
                    s.get("limit_min"),
                    s.get("limit_max"),
                    s.get("limit_nominal"),
                    s.get("limit_tolerance"),
                    s.get("unit"),
                    s.get("instructions"),
                    s.get("safety_warning"),
                ),
            )
        if body.import_id:
            await db.execute(
                "UPDATE atp_imports SET definition_id = ?, extraction_status = 'linked' WHERE id = ?",
                (def_id, body.import_id),
            )
        await db.execute(
            "UPDATE atp_definitions SET updated_at = datetime('now') WHERE id = ?",
            (def_id,),
        )
        await db.commit()

        cur = await db.execute(
            """
            SELECT ad.*, COUNT(s.id) AS step_count
            FROM atp_definitions ad
            LEFT JOIN atp_steps s ON s.definition_id = ad.id
            WHERE ad.id = ?
            GROUP BY ad.id
            """,
            (def_id,),
        )
        row = await cur.fetchone()
        await log_audit(
            user.id, "atp_ai_extract", "atp_definition", def_id,
            f"{len(steps)} steps extracted",
        )
        return _row_to_summary(row, row["step_count"])
    finally:
        await db.close()


@router.post(
    "/definitions/{definition_id}/steps/{step_id}/ai/safety-warning",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_safety_warning(
    definition_id: int,
    step_id: int,
    user: UserInDB = Depends(get_current_user),
):
    rate_limit.check_and_record(user)
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT * FROM atp_steps WHERE id = ? AND definition_id = ?",
            (step_id, definition_id),
        )
        step = await cur.fetchone()
        if step is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "step not found")
        try:
            warning = await ai_atp.draft_safety_warning(dict(step))
        except Exception as e:  # noqa: BLE001
            raise _ai_error_to_http(e)

        await log_audit(
            user.id, "atp_ai_safety", "atp_step", step_id,
            f"len={len(warning or '')}",
        )
        return {"safety_warning": warning}
    finally:
        await db.close()


@router.post(
    "/definitions/{definition_id}/ai/order-review",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_order_review(
    definition_id: int,
    user: UserInDB = Depends(get_current_user),
):
    rate_limit.check_and_record(user)
    db = await get_db_connection()
    try:
        cur = await db.execute(
            "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
            (definition_id,),
        )
        steps = [dict(r) for r in await cur.fetchall()]
        if not steps:
            return {"concerns": []}
        try:
            concerns = await ai_atp.review_step_ordering(steps)
        except Exception as e:  # noqa: BLE001
            raise _ai_error_to_http(e)
        await log_audit(
            user.id, "atp_ai_order_review", "atp_definition", definition_id,
            f"{len(concerns)} concern(s)",
        )
        return {"concerns": concerns}
    finally:
        await db.close()


@router.post(
    "/definitions/{base_id}/diff/{target_id}/ai/summary",
    dependencies=[Depends(require_role("engineer"))],
)
async def ai_revision_impact_summary(
    base_id: int,
    target_id: int,
    user: UserInDB = Depends(get_current_user),
):
    rate_limit.check_and_record(user)
    db = await get_db_connection()
    try:
        try:
            diff = await atp_diff.diff_definitions(db, base_id, target_id)
        except ValueError as e:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    finally:
        await db.close()

    try:
        text = await ai_atp.summarize_revision_impact(diff)
    except Exception as e:  # noqa: BLE001
        raise _ai_error_to_http(e)

    await log_audit(
        user.id, "atp_ai_impact_summary", "atp_definition", target_id,
        f"base={base_id} target={target_id}",
    )
    return {"summary": text, "diff": diff}


@router.post(
    "/import",
    response_model=DefinitionSummary,
    dependencies=[Depends(require_role("engineer"))],
)
async def import_definition(
    bundle: dict = Body(...),
    user: UserInDB = Depends(get_current_user),
):
    db = await get_db_connection()
    try:
        try:
            new_id = await atp_bundle.import_bundle(db, bundle, user)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

        cur = await db.execute(
            """
            SELECT ad.*, COUNT(s.id) AS step_count
            FROM atp_definitions ad
            LEFT JOIN atp_steps s ON s.definition_id = ad.id
            WHERE ad.id = ?
            GROUP BY ad.id
            """,
            (new_id,),
        )
        row = await cur.fetchone()
        await log_audit(user.id, "atp_import", "atp_definition", new_id)
        return _row_to_summary(row, row["step_count"])
    finally:
        await db.close()
