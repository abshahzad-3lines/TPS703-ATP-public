"""Shared driver registry — keep one connected driver per equipment_id.

The Test Execution page opens a bench WebSocket (`/ws/equipment/{id}`) per
connected role and streams readings from a real instrument (e.g. the
34465A multimeter, the N1912A power meter, the N5181B signal generator).
At the same time, the test-run execution loop wants to take measurements
on the *same* instrument when the operator clicks Take Measurement. Two
independent driver sessions to one instrument cause:

* Configuration races (`ABOR` + `CONF` in one session disturbs the other).
* Slightly different readings — each session gets its own freshly
  triggered measurement and reads at a different point in time.

This module lets the bench WebSocket *register* its connected driver so
the execution loop can borrow it for step measurements (one TCP/VISA
session, one configuration, one reading at a time).

Concurrency:

* Each driver gets an :class:`asyncio.Lock` that callers must hold around
  any `send`/`query`/`measure` call. Locks are exposed via
  :func:`get_driver_lock`.
* The bench-stream loop and the step executor both acquire the lock so
  their commands serialise on the wire.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from drivers.base import InstrumentDriver

logger = logging.getLogger(__name__)


# Registered drivers keyed by equipment_id
_drivers: dict[int, InstrumentDriver] = {}
# Per-driver locks so concurrent callers serialise their SCPI commands.
_locks: dict[int, asyncio.Lock] = {}


def register_active_driver(equipment_id: int, driver: InstrumentDriver) -> None:
    """Publish *driver* as the live driver for *equipment_id*.

    Replaces any previously registered driver for the same id (the previous
    owner is expected to have disconnected its driver already).
    """
    _drivers[equipment_id] = driver
    if equipment_id not in _locks:
        _locks[equipment_id] = asyncio.Lock()
    logger.info("Active driver registered for equipment %d", equipment_id)


def unregister_active_driver(equipment_id: int, driver: InstrumentDriver) -> None:
    """Remove *driver* from the registry if it's still the active one.

    The check prevents a stale unregister from clobbering a driver that a
    different bench-WS session has since registered.
    """
    if _drivers.get(equipment_id) is driver:
        _drivers.pop(equipment_id, None)
        logger.info("Active driver unregistered for equipment %d", equipment_id)


def get_active_driver(equipment_id: int) -> Optional[InstrumentDriver]:
    """Return the currently registered driver for *equipment_id*, or None."""
    return _drivers.get(equipment_id)


def get_driver_lock(equipment_id: int) -> asyncio.Lock:
    """Return (or create) the asyncio.Lock that serialises access to the
    driver for *equipment_id*. Always returns a Lock so callers can use a
    single ``async with`` site whether or not the driver is registered yet."""
    lock = _locks.get(equipment_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[equipment_id] = lock
    return lock
