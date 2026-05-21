"""Reconcile the ``equipment`` table against what is actually reachable on this PC.

Why this exists
---------------
The ``equipment`` table carries whatever ``connection_address`` values were
recorded the last time someone used a given bench. On a different bench those
addresses are unreachable and every step measurement fails with ``WinError
10051`` before the operator can do anything about it.

This module re-discovers instruments on startup (and on demand) and
reconciles the table in three passes:

Pass 1 — Validate every active row by attempting a short ``connect()``
    against its stored address. Rows that fail are deactivated immediately.
    This catches stale IPs even when nothing new is discovered (e.g.
    instruments turned off, cable unplugged, NIC on the wrong subnet).

Pass 2 — Run discovery (PyVISA + zeroconf mDNS) and reconcile by serial:

    * Discovered instruments matched by ``*IDN?`` serial number → existing
      row's ``connection_type`` / ``connection_address`` is **healed** to
      the current reachable address, ``is_active`` is set to 1.
    * Discovered serials that don't match any row → **auto-inserted**.
    * Duplicate rows for the same serial → all but the lowest-id one are
      deactivated.

Pass 3 — Active rows whose serial number was **not** discovered in pass 2
    are deactivated, so the UI doesn't pretend a stale instrument is
    connected.

Nothing about the network is hardcoded — discovery enumerates PyVISA
resources and listens for zeroconf mDNS (_lxi / _scpi-raw / _vxi-11) on
whatever subnet the PC happens to be on.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional


import dbx
from config import settings
from drivers import driver_factory
from drivers.base import InstrumentDriver
from services.equipment_discovery import discover_all

logger = logging.getLogger(__name__)


# Per-instrument connectivity probe timeout. 1.5 s is plenty for an
# instrument on the local LAN; if it doesn't respond by then we treat
# the row as unreachable and deactivate it.
_PROBE_TIMEOUT_S = 1.5


def _resolve_address(entry: dict[str, Any]) -> str:
    """Pick the right ``connection_address`` value for an equipment row.

    Mirrors :func:`routers.equipment._resolve_address` so manual auto-register
    and the startup reconcile produce identical rows.
    """
    if entry.get("connection_type") == "tcp_scpi" and entry.get("host") and entry.get("port"):
        return f"{entry['host']}:{entry['port']}"
    return entry.get("resource") or ""


async def _probe_one_row(row: dbx.Row) -> bool:
    """Return True if *row* is reachable on its stored address.

    Builds a driver via :class:`DriverFactory`, calls ``connect()`` with a
    short timeout, then disconnects. ``simulator`` rows always pass.
    Errors (timeout, unreachable network, malformed address) → False.
    """
    conn_type = (row["connection_type"] or "").lower()
    if conn_type in ("simulator", ""):
        # No network to validate — treat as reachable, the SimulatorDriver
        # has no failure modes and a blank connection_type was likely
        # manually entered.
        return True

    driver: Optional[InstrumentDriver] = None
    try:
        try:
            driver = driver_factory.create_from_equipment(dict(row))
        except Exception as exc:  # noqa: BLE001
            logger.info(
                "Reconcile probe: row id=%d (%s @ %s) — bad driver config: %s",
                row["id"], row["name"], row["connection_address"], exc,
            )
            return False

        try:
            await asyncio.wait_for(driver.connect(), timeout=_PROBE_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001
            logger.info(
                "Reconcile probe: row id=%d (%s @ %s) — UNREACHABLE: %s",
                row["id"], row["name"], row["connection_address"], exc,
            )
            return False

        logger.info(
            "Reconcile probe: row id=%d (%s @ %s) — reachable",
            row["id"], row["name"], row["connection_address"],
        )
        return True
    finally:
        if driver is not None:
            try:
                await asyncio.wait_for(driver.disconnect(), timeout=1.0)
            except Exception:
                pass


async def _log_table_snapshot(db: dbx.Connection, label: str) -> None:
    """Dump the current equipment table to the log so troubleshooting is easy."""
    cursor = await db.execute(
        """SELECT id, name, model, serial_number,
                  connection_type, connection_address, is_active, instrument_role
             FROM equipment ORDER BY id"""
    )
    rows = await cursor.fetchall()
    logger.info("Equipment table snapshot [%s] — %d row(s):", label, len(rows))
    for r in rows:
        active = "ACTIVE" if r["is_active"] else "inactive"
        logger.info(
            "  id=%d  %-10s  %-30s  sn=%-12s  role=%-18s  %s @ %s",
            r["id"],
            active,
            (r["name"] or "")[:30],
            r["serial_number"] or "-",
            r["instrument_role"] or "-",
            r["connection_type"] or "-",
            r["connection_address"] or "-",
        )


async def reconcile_equipment_with_network(mdns_timeout: float = 3.0) -> dict[str, int]:
    """Discover instruments and heal the ``equipment`` table.

    Best-effort: any exception bubbling out of discovery is logged and
    swallowed so a discovery failure never blocks the backend from starting.

    Returns a small stats dict ``{"discovered", "healed", "inserted",
    "deactivated", "unreachable"}`` for logging and the optional REST trigger.
    """
    stats = {
        "discovered": 0,
        "healed": 0,
        "inserted": 0,
        "deactivated": 0,
        "unreachable": 0,
    }

    async with dbx.connect() as db:
        await db.execute("PRAGMA foreign_keys = ON")

        await _log_table_snapshot(db, "before reconcile")

        # ============================================================
        # PASS 1 — probe every active row for connectivity. Drop the
        #          ones that don't answer within _PROBE_TIMEOUT_S.
        # ============================================================
        cursor = await db.execute(
            """SELECT id, name, model, serial_number,
                      connection_type, connection_address, is_active, instrument_role
                 FROM equipment
                WHERE is_active = 1
                  AND connection_type IS NOT NULL
                  AND TRIM(COALESCE(connection_type, '')) <> 'simulator'"""
        )
        active_rows = await cursor.fetchall()
        unreachable_ids: list[int] = []
        for row in active_rows:
            ok = await _probe_one_row(row)
            if not ok:
                unreachable_ids.append(row["id"])

        if unreachable_ids:
            qmarks = ",".join("?" * len(unreachable_ids))
            await db.execute(
                f"UPDATE equipment SET is_active = 0 WHERE id IN ({qmarks})",
                unreachable_ids,
            )
            stats["unreachable"] = len(unreachable_ids)
            logger.info(
                "Reconcile pass 1: deactivated %d unreachable row(s): %s",
                len(unreachable_ids), unreachable_ids,
            )

    # ============================================================
    # PASS 2 — run discovery and reconcile by serial number.
    # ============================================================
    try:
        discovered = await discover_all(mdns_timeout=mdns_timeout)
    except Exception:
        logger.exception(
            "Reconcile pass 2: discovery failed; skipping heal/insert"
        )
        discovered = []

    stats["discovered"] = len(discovered)
    logger.info("Reconcile pass 2: discovered %d instrument(s)", len(discovered))

    by_serial: dict[str, dict[str, Any]] = {}
    for entry in discovered:
        sn = (entry.get("serial") or "").strip()
        if sn:
            by_serial[sn] = entry

    async with dbx.connect() as db:
        await db.execute("PRAGMA foreign_keys = ON")

        for sn, entry in by_serial.items():
            cursor = await db.execute(
                "SELECT id, name FROM equipment WHERE TRIM(serial_number) = ? ORDER BY id",
                (sn,),
            )
            existing = await cursor.fetchall()

            if existing:
                primary_id = existing[0]["id"]
                duplicate_ids = [r["id"] for r in existing[1:]]

                address = _resolve_address(entry)
                await db.execute(
                    """UPDATE equipment
                          SET connection_type    = ?,
                              connection_address = ?,
                              is_active          = 1,
                              manufacturer       = COALESCE(NULLIF(?, ''), manufacturer),
                              model              = COALESCE(NULLIF(?, ''), model),
                              instrument_role    = COALESCE(instrument_role, ?)
                        WHERE id = ?""",
                    (
                        entry.get("connection_type"),
                        address,
                        entry.get("manufacturer") or "",
                        entry.get("model") or "",
                        entry.get("instrument_type"),
                        primary_id,
                    ),
                )
                stats["healed"] += 1
                logger.info(
                    "Reconcile pass 2: healed equipment id=%d serial=%s -> %s (%s)",
                    primary_id, sn, address, entry.get("connection_type"),
                )

                if duplicate_ids:
                    qmarks = ",".join("?" * len(duplicate_ids))
                    await db.execute(
                        f"UPDATE equipment SET is_active = 0 WHERE id IN ({qmarks})",
                        duplicate_ids,
                    )
                    logger.info(
                        "Reconcile pass 2: deactivated %d duplicate row(s) for serial=%s",
                        len(duplicate_ids), sn,
                    )
            else:
                manufacturer = (entry.get("manufacturer") or "").strip()
                model = (entry.get("model") or "").strip()
                name = f"{manufacturer} {model}".strip()
                if not name:
                    name = entry.get("resource") or sn

                await db.execute(
                    """INSERT INTO equipment
                           (name, model, manufacturer, serial_number,
                            connection_type, connection_address,
                            is_active, instrument_role)
                       VALUES (?, ?, ?, ?, ?, ?, 1, ?)""",
                    (
                        name,
                        model or None,
                        manufacturer or None,
                        sn,
                        entry.get("connection_type"),
                        _resolve_address(entry),
                        entry.get("instrument_type"),
                    ),
                )
                stats["inserted"] += 1
                logger.info(
                    "Reconcile pass 2: inserted new equipment serial=%s name=%r at %s",
                    sn, name, _resolve_address(entry),
                )

        # ============================================================
        # PASS 3 — deactivate active rows whose serial wasn't discovered.
        #          Combined with pass 1 above, this guarantees: every
        #          row that is_active=1 at the end of reconcile has
        #          BOTH been probed reachable in pass 1 OR healed in
        #          pass 2.
        # ============================================================
        if by_serial:
            qmarks = ",".join("?" * len(by_serial))
            cursor = await db.execute(
                f"""UPDATE equipment
                       SET is_active = 0
                     WHERE is_active = 1
                       AND serial_number IS NOT NULL
                       AND TRIM(serial_number) <> ''
                       AND TRIM(serial_number) NOT IN ({qmarks})""",
                list(by_serial.keys()),
            )
        else:
            cursor = await db.execute(
                """UPDATE equipment
                       SET is_active = 0
                     WHERE is_active = 1
                       AND serial_number IS NOT NULL
                       AND TRIM(serial_number) <> ''"""
            )
        stats["deactivated"] = cursor.rowcount or 0
        if stats["deactivated"]:
            logger.info(
                "Reconcile pass 3: deactivated %d row(s) whose instruments weren't seen on the network",
                stats["deactivated"],
            )

        await db.commit()

        await _log_table_snapshot(db, "after reconcile")

    logger.info(
        "Equipment auto-reconcile complete: discovered=%d unreachable=%d healed=%d inserted=%d deactivated=%d",
        stats["discovered"], stats["unreachable"], stats["healed"],
        stats["inserted"], stats["deactivated"],
    )
    return stats


async def schedule_startup_reconcile(mdns_timeout: float = 3.0) -> asyncio.Task:
    """Kick off reconcile as a fire-and-forget background task.

    Kept for backwards compatibility with code that wants a non-blocking
    reconcile. ``main.py``'s ``lifespan`` should usually call
    :func:`reconcile_equipment_with_network` directly so the startup is
    blocked until the table is clean.
    """
    return asyncio.create_task(
        reconcile_equipment_with_network(mdns_timeout=mdns_timeout),
        name="equipment-startup-reconcile",
    )
