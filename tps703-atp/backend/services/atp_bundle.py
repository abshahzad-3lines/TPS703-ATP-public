"""Phase 10 — ATP signed JSON export/import bundle.

The bundle is a deterministically-serialized JSON document containing the
definition + steps. A SHA-256 + HMAC-SHA-256 (over ``settings.SECRET_KEY``)
``signature`` block is appended so a receiver can detect tampering.

Format::

    {
      "format_version": "1.0",
      "exported_at": "2026-05-17T12:00:00Z",
      "exported_by": "username",
      "definition": { ... },           # one atp_definitions row, no IDs
      "steps":      [ {...}, ... ],    # atp_steps rows, no IDs
      "signature": {
        "alg": "HMAC-SHA256",
        "payload_sha256": "<hex>",
        "hmac":           "<hex>"
      }
    }

Importing creates a NEW draft revision under the same ``code`` so the
target site's audit trail is preserved.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone

import dbx

from auth.models import UserInDB
from config import settings


FORMAT_VERSION = "1.0"

_EXCLUDED_DEF_COLUMNS = {
    "id", "legacy_procedure_id", "created_by", "published_by",
    "parent_definition_id", "superseded_by_definition_id",
    "published_at", "superseded_at",
}
_EXCLUDED_STEP_COLUMNS = {"id", "definition_id", "legacy_step_id"}


def _row_to_dict(row: dbx.Row, exclude: set[str]) -> dict:
    return {k: row[k] for k in row.keys() if k not in exclude}


def _canonical_json(payload: dict) -> bytes:
    """Sort-keys + no whitespace = deterministic bytes for hashing."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sign(payload: dict) -> dict:
    blob = _canonical_json(payload)
    sha = hashlib.sha256(blob).hexdigest()
    mac = hmac.new(
        settings.SECRET_KEY.encode("utf-8"), blob, hashlib.sha256
    ).hexdigest()
    return {"alg": "HMAC-SHA256", "payload_sha256": sha, "hmac": mac}


async def export_bundle(db: dbx.Connection, definition_id: int, user: UserInDB) -> dict:
    cur = await db.execute(
        "SELECT * FROM atp_definitions WHERE id = ?", (definition_id,)
    )
    defn_row = await cur.fetchone()
    if defn_row is None:
        raise ValueError(f"definition {definition_id} not found")

    cur = await db.execute(
        "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
        (definition_id,),
    )
    step_rows = await cur.fetchall()

    payload = {
        "format_version": FORMAT_VERSION,
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "exported_by": user.username,
        "definition": _row_to_dict(defn_row, _EXCLUDED_DEF_COLUMNS),
        "steps": [_row_to_dict(s, _EXCLUDED_STEP_COLUMNS) for s in step_rows],
    }
    payload["signature"] = _sign({
        "format_version": payload["format_version"],
        "definition": payload["definition"],
        "steps": payload["steps"],
    })
    return payload


def verify_signature(bundle: dict) -> tuple[bool, str | None]:
    """Return (ok, reason). ``reason`` populated only when ``ok`` is False."""
    sig = bundle.get("signature")
    if not isinstance(sig, dict):
        return False, "missing signature block"
    if sig.get("alg") != "HMAC-SHA256":
        return False, f"unsupported alg: {sig.get('alg')}"

    payload = {
        "format_version": bundle.get("format_version"),
        "definition": bundle.get("definition"),
        "steps": bundle.get("steps"),
    }
    blob = _canonical_json(payload)
    expected_sha = hashlib.sha256(blob).hexdigest()
    expected_mac = hmac.new(
        settings.SECRET_KEY.encode("utf-8"), blob, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_sha, sig.get("payload_sha256", "")):
        return False, "payload_sha256 mismatch"
    if not hmac.compare_digest(expected_mac, sig.get("hmac", "")):
        return False, "hmac mismatch (different SECRET_KEY or tampered bundle)"
    return True, None


async def import_bundle(
    db: dbx.Connection,
    bundle: dict,
    user: UserInDB,
    *,
    enforce_signature: bool = True,
) -> int:
    """Insert the bundle as a NEW draft revision under the same code.

    Returns the newly created ``atp_definitions.id``.
    """
    if enforce_signature:
        ok, reason = verify_signature(bundle)
        if not ok:
            raise ValueError(f"bundle signature invalid: {reason}")

    if bundle.get("format_version") != FORMAT_VERSION:
        raise ValueError(
            f"unsupported format_version: {bundle.get('format_version')}"
        )

    defn = bundle["definition"]
    steps = bundle["steps"]

    # Locate the subsystem by drawing_no if available; otherwise reject.
    cur = await db.execute(
        "SELECT id FROM subsystems WHERE id = ?", (defn["subsystem_id"],)
    )
    if not await cur.fetchone():
        raise ValueError(
            f"subsystem_id {defn['subsystem_id']} from bundle not present locally"
        )

    # Find an unused revision letter for this code
    cur = await db.execute(
        "SELECT revision FROM atp_definitions WHERE code = ?", (defn["code"],)
    )
    used = {r["revision"] for r in await cur.fetchall()}
    new_rev = _next_revision(used)

    insert_cur = await db.execute(
        """
        INSERT INTO atp_definitions (
            subsystem_id, code, revision, name, section_ref, sequence_order,
            warmup_minutes, default_pulse_width_us, requires_calibration,
            state, source, created_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'authored', ?, ?)
        """,
        (
            defn["subsystem_id"], defn["code"], new_rev, defn["name"],
            defn.get("section_ref"), defn.get("sequence_order"),
            defn.get("warmup_minutes"), defn.get("default_pulse_width_us"),
            defn.get("requires_calibration") or 0,
            user.id,
            f"Imported from signed bundle (origin rev '{defn.get('revision')}')",
        ),
    )
    new_id = insert_cur.lastrowid

    for s in steps:
        await db.execute(
            """
            INSERT INTO atp_steps (
                definition_id, step_number, name, step_type, instrument,
                frequency_mhz, input_power_dbm, pulse_width_us, mux_address,
                mux_sample_time_us, bus_address, bus_data, bus_rw,
                limit_type, limit_min, limit_max, limit_nominal,
                limit_tolerance, unit, instructions, safety_warning,
                is_optional, is_record_only
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                s["step_number"], s["name"], s["step_type"], s.get("instrument"),
                s.get("frequency_mhz"), s.get("input_power_dbm"),
                s.get("pulse_width_us"), s.get("mux_address"),
                s.get("mux_sample_time_us"), s.get("bus_address"),
                s.get("bus_data"), s.get("bus_rw"), s.get("limit_type"),
                s.get("limit_min"), s.get("limit_max"), s.get("limit_nominal"),
                s.get("limit_tolerance"), s.get("unit"), s.get("instructions"),
                s.get("safety_warning"), s.get("is_optional") or 0,
                s.get("is_record_only") or 0,
            ),
        )

    await db.execute(
        """
        INSERT INTO atp_state_transitions
            (definition_id, from_state, to_state, user_id, comment)
        VALUES (?, NULL, 'draft', ?, ?)
        """,
        (new_id, user.id, f"imported from signed bundle (orig rev '{defn.get('revision')}')"),
    )

    await db.commit()
    return new_id


def _next_revision(used: set[str]) -> str:
    up = {r.upper() for r in used if r}
    def gen():
        for c in range(65, 91):
            yield chr(c)
        for c1 in range(65, 91):
            for c2 in range(65, 91):
                yield chr(c1) + chr(c2)
    for cand in gen():
        if cand not in up:
            return cand
    return "ZZ"
