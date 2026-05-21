"""Phase 10 — Golden-unit simulation.

Runs the draft ATP's steps against the in-process ``SimulatorDriver`` and
evaluates each measurement against the step's declared limits. Produces
a summary row in ``atp_simulations`` plus a JSON payload listing pass /
fail / skipped step counts and per-step results.

This is a dry-run: no ``test_run``, no ``test_results``, no equipment
contact. Engineers use it to confirm the limits + step shape will pass
the historical "golden" measurements for a known-good UUT before
publishing.
"""

from __future__ import annotations

import json

import dbx

from auth.models import UserInDB
from drivers.simulator import SimulatorDriver


async def simulate_definition(
    db: dbx.Connection,
    definition_id: int,
    user: UserInDB,
) -> dict:
    cur = await db.execute(
        "SELECT * FROM atp_steps WHERE definition_id = ? ORDER BY step_number",
        (definition_id,),
    )
    steps = await cur.fetchall()
    if not steps:
        raise ValueError("no steps to simulate")

    sim = SimulatorDriver(failure_probability=0.0, seed=42)
    await sim.connect()
    try:
        results = []
        pass_count = 0
        fail_count = 0
        skipped_count = 0
        for s in steps:
            row = dict(s)
            try:
                meas = await sim.measure(row["step_type"], row)
            except Exception as e:  # noqa: BLE001
                skipped_count += 1
                results.append({
                    "step_number": row["step_number"],
                    "name": row["name"],
                    "status": "skipped",
                    "reason": f"simulator could not produce a reading: {e}",
                })
                continue

            value = meas.get("value")
            verdict, reason = _evaluate(row, value)
            if verdict == "pass":
                pass_count += 1
            elif verdict == "fail":
                fail_count += 1
            else:
                skipped_count += 1

            results.append({
                "step_number": row["step_number"],
                "name": row["name"],
                "step_type": row["step_type"],
                "measured": value,
                "unit": row["unit"],
                "limit_min": row["limit_min"],
                "limit_max": row["limit_max"],
                "limit_nominal": row["limit_nominal"],
                "limit_tolerance": row["limit_tolerance"],
                "status": verdict,
                "reason": reason,
            })
    finally:
        await sim.disconnect()

    summary = {
        "pass_count": pass_count,
        "fail_count": fail_count,
        "skipped_count": skipped_count,
        "results": results,
    }

    insert_cur = await db.execute(
        """
        INSERT INTO atp_simulations
            (definition_id, pass_count, fail_count, skipped_count,
             summary_json, simulated_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            definition_id, pass_count, fail_count, skipped_count,
            json.dumps(summary), user.id,
        ),
    )
    sim_id = insert_cur.lastrowid
    await db.commit()
    summary["simulation_id"] = sim_id
    return summary


def _evaluate(row: dict, value) -> tuple[str, str | None]:
    """Return (verdict, reason). verdict in {pass, fail, skipped}."""
    if row.get("is_record_only"):
        return "pass", "record-only step"
    if value is None or not isinstance(value, (int, float)):
        return "skipped", "no numeric value produced"

    lmin = row.get("limit_min")
    lmax = row.get("limit_max")
    nom = row.get("limit_nominal")
    tol = row.get("limit_tolerance")

    if nom is not None and tol is not None:
        lmin = nom - tol
        lmax = nom + tol

    if lmin is None and lmax is None:
        return "skipped", "no limits declared"

    if lmin is not None and value < lmin:
        return "fail", f"{value} < min {lmin}"
    if lmax is not None and value > lmax:
        return "fail", f"{value} > max {lmax}"
    return "pass", None
