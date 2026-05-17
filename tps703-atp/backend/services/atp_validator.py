"""Phase 10 — ATP step-schema validator.

A draft must pass validation before it can transition into ``approved`` or
``published``. Returns a list of human-readable issue strings; an empty
list means "publishable".

Validation rules:
1. At least one step.
2. ``step_number`` values are 1..N with no gaps and no duplicates.
3. Each step has a non-empty ``name`` and a known ``step_type``.
4. Measurement step types declare a ``unit`` and at least one of
   (limit_min, limit_max, limit_nominal+limit_tolerance), unless the step
   is flagged ``is_record_only``.
5. Every step whose ``step_type`` requires an instrument maps to a known
   ``instrument_role`` and at least one ``equipment`` row exists with that
   role (warning, not block, if no equipment yet — but block on publish).
6. Frequency-driven steps have ``frequency_mhz`` set; power-driven steps
   have ``input_power_dbm`` set.
"""

from __future__ import annotations

import aiosqlite


# step_type → required instrument_role (None = no instrument needed)
STEP_TYPE_ROLE: dict[str, str | None] = {
    # Power-meter
    "output_power": "power_meter",
    "input_current": "multimeter",
    # Multimeter
    "current": "multimeter",
    "resistance": "multimeter",
    "voltage": "multimeter",
    "mux_voltage": "multimeter",
    # Oscilloscope
    "pulse_width": "oscilloscope",
    "droop": "oscilloscope",
    # Spectrum analyzer
    "spectrum": "spectrum_analyzer",
    "harmonic": "spectrum_analyzer",
    # Network analyzer
    "return_loss": "network_analyzer",
    "vswr": "network_analyzer",
    "s11": "network_analyzer",
    # Phase meter
    "phase_shift": "phase_meter",
    "frequency": "phase_meter",
    # FFT (IF receiver)
    "fft_peak": "fft_display",
    "fft_noise": "fft_display",
    "fft_sfdr": "fft_display",
    # Common bus (IF receiver)
    "bus_read": "common_bus",
    "bus_write": "common_bus",
    "bite_signal": "common_bus",
    # Signal generator stimulus
    "sg_setup": "signal_generator",
    # Manual / record-only / verification
    "visual_inspection": None,
    "manual_record": None,
    "warmup": None,
    "settling": None,
}

# Step types where ``frequency_mhz`` should normally be set
FREQUENCY_DRIVEN = {
    "output_power", "return_loss", "phase_shift", "spectrum", "harmonic",
    "s11", "vswr", "sg_setup",
}
# Step types where ``input_power_dbm`` should normally be set
POWER_DRIVEN = {"output_power", "return_loss", "phase_shift", "sg_setup"}

# Step types that produce a quantitative measurement (need unit + limits
# unless flagged record_only).
MEASUREMENT_STEP_TYPES = {
    "output_power", "input_current", "current", "resistance", "voltage",
    "mux_voltage", "pulse_width", "droop", "spectrum", "harmonic",
    "return_loss", "vswr", "s11", "phase_shift", "frequency",
    "fft_peak", "fft_noise", "fft_sfdr",
}


async def validate_definition(
    db: aiosqlite.Connection,
    definition_id: int,
    *,
    require_equipment: bool = True,
) -> list[str]:
    """Return a list of blocking issues. Empty list = valid."""
    issues: list[str] = []

    cur = await db.execute(
        "SELECT * FROM atp_definitions WHERE id = ?", (definition_id,)
    )
    defn = await cur.fetchone()
    if defn is None:
        return [f"definition {definition_id} not found"]

    cur = await db.execute(
        "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
        (definition_id,),
    )
    steps = await cur.fetchall()

    if not steps:
        issues.append("ATP has no steps.")
        return issues

    # 2. step_number contiguity
    numbers = [s["step_number"] for s in steps]
    if len(set(numbers)) != len(numbers):
        issues.append("Duplicate step_number values present.")
    expected = list(range(1, len(steps) + 1))
    if sorted(numbers) != expected:
        issues.append(
            f"step_numbers must be 1..{len(steps)} with no gaps "
            f"(got {sorted(numbers)})."
        )

    # Collect distinct roles referenced
    required_roles: set[str] = set()

    for s in steps:
        prefix = f"Step {s['step_number']} ({s['name'] or '?'})"

        # 3a. Name + step_type
        if not (s["name"] or "").strip():
            issues.append(f"{prefix}: missing name.")
        st = (s["step_type"] or "").strip()
        if not st:
            issues.append(f"{prefix}: missing step_type.")
            continue
        if st not in STEP_TYPE_ROLE:
            issues.append(f"{prefix}: unknown step_type '{st}'.")
            # Don't abort; still apply downstream checks defensively.

        # 4. Measurement steps need a unit + limits
        if st in MEASUREMENT_STEP_TYPES and not s["is_record_only"]:
            if not (s["unit"] or "").strip():
                issues.append(f"{prefix}: measurement step missing 'unit'.")
            has_limit = (
                s["limit_min"] is not None
                or s["limit_max"] is not None
                or (s["limit_nominal"] is not None and s["limit_tolerance"] is not None)
            )
            if not has_limit:
                issues.append(
                    f"{prefix}: measurement step has no limits "
                    "(limit_min, limit_max, or nominal±tolerance)."
                )

        # 5. instrument role
        role = STEP_TYPE_ROLE.get(st)
        if role:
            required_roles.add(role)

        # 6. frequency / power expectations
        if st in FREQUENCY_DRIVEN and s["frequency_mhz"] is None:
            issues.append(f"{prefix}: '{st}' requires frequency_mhz.")
        if st in POWER_DRIVEN and s["input_power_dbm"] is None:
            issues.append(f"{prefix}: '{st}' requires input_power_dbm.")

    # 5b. Check equipment availability for every required role
    if require_equipment and required_roles:
        cur = await db.execute(
            "SELECT DISTINCT instrument_role FROM equipment "
            "WHERE is_active = 1 AND instrument_role IS NOT NULL"
        )
        available = {r["instrument_role"] for r in await cur.fetchall()}
        missing = sorted(required_roles - available)
        if missing:
            issues.append(
                "No registered equipment for required instrument role(s): "
                + ", ".join(missing)
            )

    return issues


async def validate_for_publish(db: aiosqlite.Connection, definition_id: int) -> list[str]:
    """Stricter check used by the state-machine on transitions into approved/published."""
    return await validate_definition(db, definition_id, require_equipment=True)
