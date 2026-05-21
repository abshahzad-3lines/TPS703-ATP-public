"""Equipment Bench API — single-shot measurements, simulator comparison, raw SCPI.

Provides diagnostic endpoints for exercising registered test equipment alongside
the SimulatorDriver so an operator can validate that a real instrument is
behaving correctly.  Read-only endpoints (`/measure`, `/simulate`) are
intentionally not audit-logged; raw SCPI commands always are.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.websockets import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from auth.dependencies import require_role
from auth.models import UserInDB
import dbx
from config import settings
from drivers import driver_factory
from drivers.base import InstrumentDriver
from drivers.simulator import SimulatorDriver
from services.active_drivers import (
    get_driver_lock,
    register_active_driver,
    unregister_active_driver,
)
from services.audit import log_audit


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/equipment", tags=["equipment-bench"])
ws_router = APIRouter(tags=["equipment-bench"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class MeasureRequest(BaseModel):
    """Body for /measure and /simulate."""

    step_type: str = Field(..., min_length=1, description="Simulator step_type key (e.g. 'voltage', 'output_power')")
    params: dict[str, Any] = Field(default_factory=dict, description="Optional measurement parameters")


class MeasureResponse(BaseModel):
    """Single-shot measurement response."""

    value: Optional[float] = None
    secondary_value: Optional[float] = None
    raw_data: Optional[Any] = None
    source: str  # "live" | "simulator"
    timestamp: str


class ScpiRequest(BaseModel):
    """Body for /scpi."""

    command: str = Field(..., min_length=1)
    is_query: bool = False


class ScpiResponse(BaseModel):
    """Result of a raw SCPI transaction."""

    response: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_equipment(equipment_id: int) -> dict[str, Any]:
    """Load an equipment row by id; raise 404 if missing."""
    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE id = ?", (equipment_id,)
        )
        row = await cursor.fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Equipment with id {equipment_id} not found",
        )
    return dict(row)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _measure_once(driver: InstrumentDriver, step_type: str, params: dict) -> dict:
    """Connect, measure, disconnect — a single bench reading."""
    await driver.connect()
    try:
        return await driver.measure(step_type, params or {})
    finally:
        try:
            await driver.disconnect()
        except Exception:  # noqa: BLE001 — best-effort cleanup
            logger.exception("Driver disconnect failed during bench measurement")


# ---------------------------------------------------------------------------
# POST /api/equipment/simulate — simulator reference reading
# ---------------------------------------------------------------------------


@router.post("/simulate", response_model=MeasureResponse)
async def simulate_measure(
    body: MeasureRequest,
    current_user: UserInDB = Depends(require_role("technician")),
) -> MeasureResponse:
    """Take a single measurement from the SimulatorDriver.

    Returns the same shape as ``/measure`` so the frontend can call live + sim
    symmetrically.
    """
    driver = SimulatorDriver()
    result = await _measure_once(driver, body.step_type, body.params)
    return MeasureResponse(
        value=result.get("value"),
        secondary_value=result.get("secondary_value"),
        raw_data=result.get("raw_data"),
        source="simulator",
        timestamp=_now_iso(),
    )


# ---------------------------------------------------------------------------
# POST /api/equipment/{id}/measure — single-shot live reading
# ---------------------------------------------------------------------------


@router.post("/{equipment_id}/measure", response_model=MeasureResponse)
async def measure_equipment(
    equipment_id: int,
    body: MeasureRequest,
    current_user: UserInDB = Depends(require_role("technician")),
) -> MeasureResponse:
    """Take a single measurement from the registered equipment."""
    row = await _load_equipment(equipment_id)
    try:
        driver = driver_factory.create_from_equipment(row)
    except (NotImplementedError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot create driver for equipment {equipment_id}: {exc}",
        )

    try:
        result = await _measure_once(driver, body.step_type, body.params)
    except Exception as exc:  # noqa: BLE001 — surfaced to the client
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Live measurement failed: {exc}",
        )

    return MeasureResponse(
        value=result.get("value"),
        secondary_value=result.get("secondary_value"),
        raw_data=result.get("raw_data"),
        source="live",
        timestamp=_now_iso(),
    )


# ---------------------------------------------------------------------------
# POST /api/equipment/{id}/scpi — raw SCPI transaction
# ---------------------------------------------------------------------------


@router.post("/{equipment_id}/scpi", response_model=ScpiResponse)
async def scpi_command(
    equipment_id: int,
    body: ScpiRequest,
    current_user: UserInDB = Depends(require_role("engineer")),
) -> ScpiResponse:
    """Send a raw SCPI command (or query) to the equipment.

    Engineer role required.  Every command is audit-logged.
    """
    row = await _load_equipment(equipment_id)
    try:
        driver = driver_factory.create_from_equipment(row)
    except (NotImplementedError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot create driver for equipment {equipment_id}: {exc}",
        )

    response: Optional[str] = None
    error: Optional[str] = None
    try:
        await driver.connect()
        try:
            if body.is_query:
                response = await driver.query(body.command)
            else:
                await driver.send(body.command)
        finally:
            try:
                await driver.disconnect()
            except Exception:  # noqa: BLE001
                logger.exception("Driver disconnect failed after SCPI")
    except Exception as exc:  # noqa: BLE001
        error = str(exc)

    await log_audit(
        user_id=current_user.id,
        action="scpi",
        entity_type="equipment",
        entity_id=equipment_id,
        details=f"{'query' if body.is_query else 'send'}: {body.command}",
    )

    return ScpiResponse(response=response, error=error)


# ---------------------------------------------------------------------------
# WebSocket /ws/equipment/{id} — streaming bench session
# ---------------------------------------------------------------------------


def _safe_iso() -> str:
    return _now_iso()


async def _bench_stream_loop(
    websocket: WebSocket,
    live_driver: Optional[InstrumentDriver],
    sim_driver: SimulatorDriver,
    step_type: str,
    params: dict,
    interval_ms: int,
    include_simulator: bool,
    stop_event: asyncio.Event,
    equipment_id: Optional[int] = None,
) -> None:
    """Emit live + (optional) simulator readings until stop_event fires.

    When ``equipment_id`` is supplied, each tick serialises through the
    shared driver lock so the test-run execution loop can borrow the same
    driver mid-stream without racing on configuration or read commands.
    """
    delay = max(0.05, interval_ms / 1000.0)
    lock = get_driver_lock(equipment_id) if equipment_id is not None else None
    while not stop_event.is_set():
        try:
            if live_driver is not None:
                if lock is not None:
                    async with lock:
                        live_result = await live_driver.measure(step_type, params)
                else:
                    live_result = await live_driver.measure(step_type, params)
                await websocket.send_json(
                    {
                        "type": "reading",
                        "source": "live",
                        "value": live_result.get("value"),
                        "secondary_value": live_result.get("secondary_value"),
                        "raw_data": live_result.get("raw_data"),
                        "timestamp": _safe_iso(),
                    }
                )
            if include_simulator:
                sim_result = await sim_driver.measure(step_type, params)
                await websocket.send_json(
                    {
                        "type": "reading",
                        "source": "simulator",
                        "value": sim_result.get("value"),
                        "secondary_value": sim_result.get("secondary_value"),
                        "raw_data": sim_result.get("raw_data"),
                        "timestamp": _safe_iso(),
                    }
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Bench stream tick failed for equipment_id=%s step_type=%r: %s",
                equipment_id,
                step_type,
                exc,
            )
            try:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": (
                            "Instrument did not respond on this tick. "
                            "Retrying — check the instrument if this persists."
                        ),
                    }
                )
            except Exception:
                return

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=delay)
        except asyncio.TimeoutError:
            continue


@ws_router.websocket("/ws/equipment/{equipment_id}")
async def equipment_bench_ws_route(websocket: WebSocket, equipment_id: int) -> None:
    """Public bench WebSocket entrypoint — wraps :func:`_run_bench_websocket`."""
    await _run_bench_websocket(websocket, equipment_id)


async def _run_bench_websocket(websocket: WebSocket, equipment_id: int) -> None:
    """Bench WebSocket implementation.

    Registered as a top-level route at ``/ws/equipment/{id}`` from ``main.py``
    (and again on the test app fixture).  Accepts ``start_stream`` /
    ``stop_stream`` / ``scpi`` messages.
    """
    await websocket.accept()

    try:
        row = await _load_equipment(equipment_id)
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "message": exc.detail})
        await websocket.close()
        return

    sim_driver = SimulatorDriver()
    live_driver: Optional[InstrumentDriver] = None
    stream_task: Optional[asyncio.Task] = None
    stop_event: Optional[asyncio.Event] = None

    async def stop_stream() -> None:
        nonlocal stream_task, stop_event, live_driver
        if stop_event is not None:
            stop_event.set()
        if stream_task is not None:
            try:
                await stream_task
            except Exception:  # noqa: BLE001
                logger.exception("Stream task raised on shutdown")
        stream_task = None
        stop_event = None
        if live_driver is not None:
            unregister_active_driver(equipment_id, live_driver)
            try:
                await live_driver.disconnect()
            except Exception:  # noqa: BLE001
                logger.exception("Live driver disconnect failed")
        live_driver = None

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "start_stream":
                if stream_task is not None:
                    await stop_stream()

                step_type = str(data.get("step_type") or "")
                params = data.get("params") or {}
                interval_ms = int(data.get("interval_ms") or 500)
                include_simulator = bool(data.get("include_simulator", True))

                if not step_type:
                    await websocket.send_json(
                        {"type": "error", "message": "start_stream requires step_type"}
                    )
                    continue

                try:
                    live_driver = driver_factory.create_from_equipment(row)
                    await live_driver.connect()
                except Exception as exc:  # noqa: BLE001
                    live_driver = None
                    await websocket.send_json(
                        {"type": "error", "message": f"Live driver unavailable: {exc}"}
                    )
                    # Still allow simulator-only stream
                    if not include_simulator:
                        continue

                # Publish the connected driver so the test-run execution
                # loop can borrow it for step measurements (instead of
                # opening its own competing session).
                if live_driver is not None:
                    register_active_driver(equipment_id, live_driver)

                stop_event = asyncio.Event()
                stream_task = asyncio.create_task(
                    _bench_stream_loop(
                        websocket=websocket,
                        live_driver=live_driver,
                        sim_driver=sim_driver,
                        step_type=step_type,
                        params=params,
                        interval_ms=interval_ms,
                        include_simulator=include_simulator,
                        stop_event=stop_event,
                        equipment_id=equipment_id,
                    )
                )
                await websocket.send_json({"type": "stream_state", "running": True})

            elif msg_type == "stop_stream":
                await stop_stream()
                await websocket.send_json({"type": "stream_state", "running": False})

            elif msg_type == "scpi":
                command = str(data.get("command") or "")
                is_query = bool(data.get("is_query", False))
                if not command:
                    await websocket.send_json(
                        {"type": "error", "message": "scpi requires a command"}
                    )
                    continue

                resp: Optional[str] = None
                err: Optional[str] = None

                # If a stream owns the driver, reuse it; otherwise create one shot
                owned = live_driver is None
                temp_driver: Optional[InstrumentDriver] = None
                try:
                    target = live_driver
                    if target is None:
                        temp_driver = driver_factory.create_from_equipment(row)
                        await temp_driver.connect()
                        target = temp_driver
                    if is_query:
                        resp = await target.query(command)
                    else:
                        await target.send(command)
                except Exception as exc:  # noqa: BLE001
                    err = str(exc)
                finally:
                    if owned and temp_driver is not None:
                        try:
                            await temp_driver.disconnect()
                        except Exception:  # noqa: BLE001
                            logger.exception("Temp SCPI driver disconnect failed")

                await log_audit(
                    user_id=None,
                    action="scpi",
                    entity_type="equipment",
                    entity_id=equipment_id,
                    details=f"ws-{'query' if is_query else 'send'}: {command}",
                )
                await websocket.send_json(
                    {"type": "scpi_response", "response": resp, "error": err}
                )

            else:
                await websocket.send_json(
                    {"type": "error", "message": f"Unknown message type: {msg_type}"}
                )

    except WebSocketDisconnect:
        pass
    finally:
        await stop_stream()
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
