"""Execution runner: drives the step-by-step execution loop for a test run.

Supports two execution modes:
- **auto**: Steps execute automatically with a configurable delay between each.
- **manual**: Pauses before each step and waits for a "take" trigger.

When a run is started, this module spawns an asyncio task that:
1. Iterates through each step in order
2. Waits for the configured delay (auto) or a manual trigger (manual mode)
3. Calls the instrument driver (simulator or real)
4. Evaluates pass/fail against limits
5. Stores immutable results in the database
6. Broadcasts live updates via WebSocket
7. Handles pause/resume/abort interrupts
"""

import asyncio
import logging
from typing import Optional

import aiosqlite

from config import settings
from drivers import driver_factory, get_driver
from drivers.base import InstrumentDriver
from services.active_drivers import (
    get_active_driver,
    get_driver_lock,
)
from services.step_executor import StepExecutor
from services.test_engine import TestEngine, RunState
from websocket.manager import ws_manager

logger = logging.getLogger("execution_runner")
logging.basicConfig(level=logging.INFO)

def _log(msg: str) -> None:
    logger.info(msg)

# Track running execution tasks so we can cancel on abort
_running_tasks: dict[int, asyncio.Task] = {}

# Per-run execution settings
_run_mode: dict[int, str] = {}          # "auto" or "manual"
_run_delay: dict[int, float] = {}       # delay in seconds for auto mode
_step_triggers: dict[int, asyncio.Event] = {}  # manual mode trigger events

executor = StepExecutor()


def get_run_mode(run_id: int) -> dict:
    """Return current execution mode settings for a run."""
    return {
        "mode": _run_mode.get(run_id, "manual"),
        "delay": _run_delay.get(run_id, 0.0),
    }


MIN_STEP_DELAY_S: float = 3.0


def set_run_mode(run_id: int, mode: str, delay: float = 0.0) -> dict:
    """Set execution mode for a run. Mode is 'auto' or 'manual'.

    ``delay`` is clamped to a minimum of :data:`MIN_STEP_DELAY_S` regardless
    of mode so the SG / DUT have time to settle between back-to-back step
    measurements. In auto mode this is the inter-step wait; in manual mode
    it's a post-trigger settling pause after the operator clicks Take.
    """
    mode = mode if mode in ("auto", "manual") else "manual"
    delay = max(MIN_STEP_DELAY_S, float(delay))
    _run_mode[run_id] = mode
    _run_delay[run_id] = delay
    _log(f"[ExecutionRunner] Run {run_id} mode set to {mode} (delay={delay}s)")

    # If switching to auto and there's a pending trigger, fire it
    if mode == "auto":
        evt = _step_triggers.get(run_id)
        if evt and not evt.is_set():
            evt.set()

    return {"mode": mode, "delay": delay}


def is_waiting_for_trigger(run_id: int) -> bool:
    """Return True if the run is in manual mode and waiting for a trigger."""
    if _run_mode.get(run_id) != "manual":
        return False
    evt = _step_triggers.get(run_id)
    return evt is not None and not evt.is_set()


def has_running_task(run_id: int) -> bool:
    """Return True if the execution loop task for *run_id* is currently alive.

    Used by the WebSocket handler to decide whether to (re)start the loop
    when a client connects to a run that the DB still marks 'running' but
    whose in-memory task was never created or has finished (e.g. server
    restart, or a previous client crashed mid-run).
    """
    task = _running_tasks.get(run_id)
    return task is not None and not task.done()


def trigger_step(run_id: int) -> bool:
    """Trigger the next step measurement in manual mode.

    Returns True if a trigger was sent, False if no pending trigger exists.
    """
    evt = _step_triggers.get(run_id)
    if evt and not evt.is_set():
        evt.set()
        _log(f"[ExecutionRunner] Run {run_id} manual step triggered")
        return True
    _log(f"[ExecutionRunner] Run {run_id} no pending trigger to fire")
    return False


async def start_execution(engine: TestEngine, run_id: int) -> None:
    """Spawn a background task to execute all steps for a run."""
    _log(f"[ExecutionRunner] start_execution called for run {run_id}")
    if run_id in _running_tasks:
        _log(f"[ExecutionRunner] run {run_id} already has a task")
        return

    # Default to manual mode
    if run_id not in _run_mode:
        _run_mode[run_id] = "manual"
    if run_id not in _run_delay:
        _run_delay[run_id] = MIN_STEP_DELAY_S
    _step_triggers[run_id] = asyncio.Event()

    task = asyncio.create_task(_run_steps(engine, run_id))
    _log(f"[ExecutionRunner] task created for run {run_id}")
    _running_tasks[run_id] = task

    def _cleanup(t: asyncio.Task) -> None:
        # Only clean up if this task is still the registered one.
        # A retake/restart may have already replaced it with a new task.
        if _running_tasks.get(run_id) is t:
            _running_tasks.pop(run_id, None)
            _run_mode.pop(run_id, None)
            _run_delay.pop(run_id, None)
            _step_triggers.pop(run_id, None)

    task.add_done_callback(_cleanup)


def cancel_execution(run_id: int) -> None:
    """Cancel the execution task for a run (used on abort)."""
    task = _running_tasks.pop(run_id, None)
    if task and not task.done():
        task.cancel()
    _run_mode.pop(run_id, None)
    _run_delay.pop(run_id, None)
    _step_triggers.pop(run_id, None)


async def _wait_for_step_trigger(run_id: int) -> bool:
    """Wait for the step trigger based on current mode.

    In auto mode:   sleeps for the configured delay, then proceeds.
    In manual mode: waits for trigger_step() to be called, **then** sleeps
                    for the configured delay before proceeding so the SG /
                    DUT have time to settle after a retune even when the
                    operator is driving the run by hand.

    While waiting, checks for pause/abort state changes.
    Returns False if the run should stop (aborted).
    """
    mode = _run_mode.get(run_id, "manual")
    delay = _run_delay.get(run_id, 0.0)

    if mode == "auto" and delay > 0:
        # Auto mode with delay — wait for the delay period
        # but check for pause/abort every 0.2s
        elapsed = 0.0
        while elapsed < delay:
            await asyncio.sleep(min(0.2, delay - elapsed))
            elapsed += 0.2
        return True
    elif mode == "auto":
        # Auto mode with no delay — proceed immediately
        return True
    else:
        # Manual mode — wait for trigger
        evt = _step_triggers.get(run_id)
        if evt is None:
            return False

        # Broadcast that we're waiting for manual trigger
        await ws_manager.broadcast(run_id, {
            "type": "waiting_for_trigger",
            "run_id": run_id,
            "message": "Waiting for manual measurement trigger",
        })

        # Wait for trigger, checking abort every 0.3s
        while not evt.is_set():
            await asyncio.sleep(0.3)
            # Re-check mode in case it was switched to auto
            if _run_mode.get(run_id) == "auto":
                return True

        # Reset the event for the next step
        evt.clear()

        # Settling delay after the manual trigger so the SG / DUT have time
        # to stabilise before the measurement step fires. Same delay value
        # as auto mode — the operator's click is treated like an auto-fire.
        if delay > 0:
            elapsed = 0.0
            while elapsed < delay:
                await asyncio.sleep(min(0.2, delay - elapsed))
                elapsed += 0.2
                # Bail out if the run was aborted mid-wait.
                if _run_mode.get(run_id) is None:
                    return False

        return True


async def _equipment_for_role(role: str) -> Optional[dict]:
    """Look up the active equipment row whose ``instrument_role`` matches *role*.

    Returns ``None`` when no matching active row exists.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM equipment WHERE instrument_role = ? AND is_active = 1 "
            "ORDER BY id LIMIT 1",
            (role,),
        )
        row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)


async def _resolve_driver_for_step(
    state: RunState,
    step_instrument: Optional[str],
    cache: dict[str, InstrumentDriver],
    fallback: InstrumentDriver,
    borrowed_locks: Optional[dict[int, asyncio.Lock]] = None,
) -> InstrumentDriver:
    """Return the driver that should service a step in the current run.

    Resolution order:

    * No ``step_instrument`` → fallback simulator (record-only step).
    * Active equipment row with matching ``instrument_role`` → use that
      equipment, regardless of the run's ``execution_mode``. This keeps the
      recorded measurement aligned with the live-stream readings the
      operator sees on the Test Execution panels (otherwise simulator mode
      would record a synthesized value while the panel shows a real one,
      which the user has called out as confusing). Drivers are cached and
      connected lazily.
    * No matching equipment + ``execution_mode == 'live'`` → raise so the
      operator knows the run can't proceed.
    * Otherwise (no equipment + simulator mode, or unknown mode) → fall
      back to the simulator driver so the run can still complete.
    """
    if not step_instrument:
        return fallback

    role = step_instrument.strip()
    if role in cache:
        return cache[role]

    row = await _equipment_for_role(role)
    if row is None:
        if state.execution_mode == "live":
            raise RuntimeError(
                f"No active equipment registered with role '{role}'"
            )
        return fallback

    # If the bench WebSocket has a live driver session open for this
    # equipment, reuse it instead of opening a second one. The driver is
    # already connected and configured for the role's step_type, and the
    # bench-stream loop holds a per-equipment asyncio.Lock around every
    # SCPI command so we just borrow the same lock around our measure().
    equipment_id = int(row["id"])
    active = get_active_driver(equipment_id)
    if active is not None:
        cache[role] = active
        if borrowed_locks is not None:
            borrowed_locks[id(active)] = get_driver_lock(equipment_id)
        return active

    driver = driver_factory.create_from_equipment(row)
    await driver.connect()
    cache[role] = driver
    return driver


async def _run_steps(engine: TestEngine, run_id: int) -> None:
    """Execute all steps sequentially, respecting pause/abort and manual/auto mode."""
    try:
        state = engine.get_run_state(run_id)
    except Exception as e:
        _log(f"[ExecutionRunner] Cannot get run {run_id}: {e}")
        return

    _log(f"[ExecutionRunner] Starting execution for run {run_id} ({state.total_steps} steps)")

    fallback_mode = "simulator" if state.execution_mode == "simulator" else state.execution_mode
    fallback = get_driver(fallback_mode if fallback_mode in ("simulator",) else "simulator")
    await fallback.connect()

    role_drivers: dict[str, InstrumentDriver] = {}
    # Drivers borrowed from the bench-WS shared registry — we don't own
    # them (must NOT disconnect on cleanup) and we must serialise SCPI
    # commands through the per-equipment Lock the bench stream is using.
    # Key: id(driver), Value: the asyncio.Lock from active_drivers.
    borrowed_driver_locks: dict[int, asyncio.Lock] = {}

    # Tracks the SG's currently-programmed stimulus so later steps that
    # advertise their own frequency_mhz / input_power_dbm can reprogram
    # the SG only when those values differ from what's already on it.
    # Seeded by the first sg_setup step; pulse mode is held as the
    # pulse_width_us value (None = CW, non-None = internal pulse).
    current_sg_freq_mhz: Optional[float] = None
    current_sg_power_dbm: Optional[float] = None
    last_sg_pulse_width_us: Optional[float] = None

    try:
        while True:
            # Check current status
            try:
                state = engine.get_run_state(run_id)
            except Exception:
                break

            if state.status == 'aborted':
                break

            # Wait while paused
            while state.status == 'paused':
                await asyncio.sleep(0.3)
                try:
                    state = engine.get_run_state(run_id)
                except Exception:
                    return
                if state.status == 'aborted':
                    return

            if state.status != 'running':
                break

            # Get current step
            step = engine.get_current_step(run_id)
            if step is None:
                # All steps done — complete the run
                state = await engine.complete_run(run_id)
                await ws_manager.broadcast(
                    run_id, ws_manager.state_change(run_id, state.status)
                )
                break

            step_index = state.current_step_index

            # Broadcast step_start
            await ws_manager.broadcast(
                run_id, ws_manager.step_start(run_id, step_index, step)
            )

            # Reprogram the SG BEFORE the trigger wait so the operator sees
            # the new stimulus on the panel and can verify it's correct
            # before clicking Take Measurement.
            #
            # If this is the seeded sg_setup step, the regular execute path
            # below will program the SG; just remember what it sets so later
            # steps can compare against it.
            if step.step_type == 'sg_setup':
                if step.frequency_mhz is not None:
                    current_sg_freq_mhz = step.frequency_mhz
                if step.input_power_dbm is not None:
                    current_sg_power_dbm = step.input_power_dbm
                last_sg_pulse_width_us = step.pulse_width_us
            else:
                # Reprogram the SG mid-procedure when this step advertises a
                # different stimulus than what the SG is currently parked at.
                # Only fires when:
                #   - the step has a frequency_mhz or input_power_dbm
                #   - those values differ from current_sg_*
                #   - a real signal_generator is registered (we got a non-
                #     fallback driver from _resolve_driver_for_step)
                # Skipped silently if no SG is registered: in live mode the
                # initial sg_setup step would have already raised; in
                # simulator mode the fallback echoes back values so there's
                # no real instrument to retune.
                step_freq = step.frequency_mhz
                step_pow = step.input_power_dbm
                needs_reprogram = (
                    (step_freq is not None and step_freq != current_sg_freq_mhz)
                    or (step_pow is not None and step_pow != current_sg_power_dbm)
                )
                if needs_reprogram:
                    try:
                        sg_driver = await _resolve_driver_for_step(
                            state, "signal_generator", role_drivers, fallback,
                            borrowed_driver_locks,
                        )
                    except RuntimeError:
                        sg_driver = None
                    if sg_driver is not None and sg_driver is not fallback:
                        target_freq = step_freq if step_freq is not None else current_sg_freq_mhz
                        target_pow = step_pow if step_pow is not None else current_sg_power_dbm
                        sg_params = {
                            "frequency_mhz": target_freq,
                            "input_power_dbm": target_pow,
                            "pulse_width_us": last_sg_pulse_width_us,
                        }
                        sg_lock = borrowed_driver_locks.get(id(sg_driver))
                        try:
                            if sg_lock is not None:
                                async with sg_lock:
                                    await sg_driver.measure("sg_setup", sg_params)
                            else:
                                await sg_driver.measure("sg_setup", sg_params)
                            current_sg_freq_mhz = target_freq
                            current_sg_power_dbm = target_pow
                            _log(
                                f"[ExecutionRunner] Run {run_id} retuned SG "
                                f"for step {step_index+1} ({step.name}): "
                                f"FREQ={target_freq} MHz, POW={target_pow} dBm"
                            )
                        except Exception as exc:
                            _log(
                                f"[ExecutionRunner] Run {run_id} SG retune "
                                f"failed before step {step_index+1}: {exc}"
                            )

            # --- Wait for trigger (manual) or delay (auto) ---
            should_continue = await _wait_for_step_trigger(run_id)
            if not should_continue:
                break

            # Re-check status after waiting (may have been aborted/paused)
            try:
                state = engine.get_run_state(run_id)
            except Exception:
                break
            if state.status == 'aborted':
                break
            if state.status == 'paused':
                continue  # Go back to the pause-wait loop

            # Build step dict for the executor
            step_dict = {
                "id": step.id,
                "step_type": step.step_type,
                "frequency_mhz": step.frequency_mhz,
                "input_power_dbm": step.input_power_dbm,
                "pulse_width_us": step.pulse_width_us,
                "mux_address": step.mux_address,
                "mux_sample_time_us": step.mux_sample_time_us,
                "bus_address": step.bus_address,
                "bus_data": step.bus_data,
                "bus_rw": step.bus_rw,
                "limit_type": step.limit_type,
                "limit_min": step.limit_min,
                "limit_max": step.limit_max,
                "limit_nominal": step.limit_nominal,
                "limit_tolerance": step.limit_tolerance,
                "is_record_only": step.is_record_only,
            }

            # Resolve the driver for this step (per-role, cached)
            driver = await _resolve_driver_for_step(
                state, step.instrument, role_drivers, fallback, borrowed_driver_locks
            )

            # Execute the step. If the driver was borrowed from a bench WS
            # session, serialise through the per-equipment lock so our
            # measure() doesn't race with the stream's tick.
            lock = borrowed_driver_locks.get(id(driver))
            if lock is not None:
                async with lock:
                    result = await executor.execute_step(run_id, step_dict, driver)
            else:
                result = await executor.execute_step(run_id, step_dict, driver)

            # Update in-memory step result
            step.result = result["pass_fail"]
            _log(f"[ExecutionRunner] Run {run_id} step {step_index+1}/{state.total_steps}: {step.name} = {result['measured_value']} -> {result['pass_fail']}")

            # Broadcast step_result
            await ws_manager.broadcast(
                run_id, ws_manager.step_result(run_id, step_index, step, result)
            )

            # Broadcast progress
            completed = sum(
                1 for s in state.steps if s.result is not None
            )
            await ws_manager.broadcast(
                run_id, ws_manager.progress(run_id, completed, state.total_steps)
            )

            # Advance to next step
            engine.advance_step(run_id)

    except asyncio.CancelledError:
        _log(f"[ExecutionRunner] Run {run_id} cancelled")
    except Exception as e:
        _log(f"[ExecutionRunner] Run {run_id} error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Disconnect only drivers we own. Drivers borrowed from a live
        # bench-WS session stay owned by that session and will be
        # disconnected when the WS closes.
        for role, drv in list(role_drivers.items()):
            if id(drv) in borrowed_driver_locks:
                continue
            try:
                await drv.disconnect()
            except Exception as exc:
                _log(f"[ExecutionRunner] Run {run_id} role '{role}' disconnect error: {exc}")
        try:
            await fallback.disconnect()
        except Exception as exc:
            _log(f"[ExecutionRunner] Run {run_id} fallback disconnect error: {exc}")
        _log(f"[ExecutionRunner] Run {run_id} execution loop finished")
