"""Phase 10 — Side-by-side revision diff service.

Computes a structured diff between two ``atp_definitions`` rows: which
metadata fields changed, which steps were added / removed / modified, and
for each modified step which fields differ.

The diff format is intentionally JSON-friendly so the frontend can render
a side-by-side redline without re-parsing.
"""

from __future__ import annotations

import dbx


_DEF_FIELDS = (
    "code", "revision", "name", "section_ref", "sequence_order",
    "warmup_minutes", "default_pulse_width_us", "requires_calibration",
    "notes",
)

_STEP_FIELDS = (
    "name", "step_type", "instrument", "frequency_mhz", "input_power_dbm",
    "pulse_width_us", "mux_address", "mux_sample_time_us", "bus_address",
    "bus_data", "bus_rw", "limit_type", "limit_min", "limit_max",
    "limit_nominal", "limit_tolerance", "unit", "instructions",
    "safety_warning", "is_optional", "is_record_only",
)


async def diff_definitions(
    db: dbx.Connection,
    base_id: int,
    target_id: int,
) -> dict:
    """Compute a structured diff: ``base`` (the older rev) vs ``target``."""
    base = await _load(db, base_id)
    target = await _load(db, target_id)

    metadata_changes = []
    for field in _DEF_FIELDS:
        b, t = base["def"][field], target["def"][field]
        if b != t:
            metadata_changes.append({"field": field, "base": b, "target": t})

    base_by_num = {s["step_number"]: s for s in base["steps"]}
    target_by_num = {s["step_number"]: s for s in target["steps"]}

    added: list = []
    removed: list = []
    modified: list = []
    unchanged_count = 0

    for n in sorted(set(base_by_num) | set(target_by_num)):
        b = base_by_num.get(n)
        t = target_by_num.get(n)
        if b is None:
            added.append(t)
        elif t is None:
            removed.append(b)
        else:
            step_changes = []
            for field in _STEP_FIELDS:
                if b[field] != t[field]:
                    step_changes.append({
                        "field": field, "base": b[field], "target": t[field],
                    })
            if step_changes:
                modified.append({
                    "step_number": n,
                    "name": t["name"] or b["name"],
                    "changes": step_changes,
                })
            else:
                unchanged_count += 1

    return {
        "base": {
            "id": base_id,
            "code": base["def"]["code"],
            "revision": base["def"]["revision"],
            "state": base["def"]["state"],
        },
        "target": {
            "id": target_id,
            "code": target["def"]["code"],
            "revision": target["def"]["revision"],
            "state": target["def"]["state"],
        },
        "metadata_changes": metadata_changes,
        "steps": {
            "added": added,
            "removed": removed,
            "modified": modified,
            "unchanged_count": unchanged_count,
        },
    }


async def _load(db, definition_id: int) -> dict:
    cur = await db.execute(
        "SELECT * FROM atp_definitions WHERE id = ?", (definition_id,)
    )
    defn = await cur.fetchone()
    if defn is None:
        raise ValueError(f"definition {definition_id} not found")
    cur = await db.execute(
        "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
        (definition_id,),
    )
    steps = [dict(s) for s in await cur.fetchall()]
    return {"def": dict(defn), "steps": steps}
