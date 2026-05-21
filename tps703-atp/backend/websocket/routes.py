"""WebSocket routes for live test data streaming."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import dbx
from services.test_engine import engine, InvalidStateTransition, TestRunNotFound, TestRunNotActive, RunState, StepInfo
from services.execution_runner import start_execution, cancel_execution, trigger_step, set_run_mode, get_run_mode, is_waiting_for_trigger, has_running_task
from websocket.manager import ws_manager


async def _load_terminal_run_ws(run_id: int) -> RunState | None:
    """Load a terminal-state run from DB for WebSocket display."""
    async with dbx.connect() as db:
        cursor = await db.execute("SELECT * FROM test_runs WHERE id = ?", (run_id,))
        run_row = await cursor.fetchone()
        if run_row is None:
            return None
        cursor = await db.execute(
            "SELECT * FROM test_steps WHERE procedure_id = ? ORDER BY step_number",
            (run_row["procedure_id"],),
        )
        step_rows = await cursor.fetchall()
        cursor = await db.execute(
            "SELECT step_id, pass_fail FROM test_results WHERE test_run_id = ?", (run_id,),
        )
        result_map = {r["step_id"]: r["pass_fail"] for r in await cursor.fetchall()}
    steps = [
        StepInfo(
            id=row["id"], step_number=row["step_number"], name=row["name"],
            step_type=row["step_type"], instrument=row["instrument"],
            frequency_mhz=row["frequency_mhz"], input_power_dbm=row["input_power_dbm"],
            pulse_width_us=row["pulse_width_us"], mux_address=row["mux_address"],
            mux_sample_time_us=row["mux_sample_time_us"], bus_address=row["bus_address"],
            bus_data=row["bus_data"], bus_rw=row["bus_rw"],
            limit_type=row["limit_type"], limit_min=row["limit_min"],
            limit_max=row["limit_max"], limit_nominal=row["limit_nominal"],
            limit_tolerance=row["limit_tolerance"], unit=row["unit"],
            instructions=row["instructions"], safety_warning=row["safety_warning"],
            is_optional=bool(row["is_optional"]), is_record_only=bool(row["is_record_only"]),
            result=result_map.get(row["id"]),
        )
        for row in step_rows
    ]
    return RunState(
        run_id=run_id, procedure_id=run_row["procedure_id"],
        uut_id=run_row["uut_id"], calibration_id=run_row["calibration_id"],
        started_by=run_row["started_by"],
        execution_mode=run_row["execution_mode"] or "simulator",
        status=run_row["status"], current_step_index=len(steps),
        total_steps=len(steps), steps=steps,
        started_at=run_row["started_at"], completed_at=run_row["completed_at"],
    )

router = APIRouter()


@router.websocket("/ws/test/{run_id}")
async def test_websocket(websocket: WebSocket, run_id: int):
    """WebSocket endpoint for live test run updates.

    On connect, sends the current run state. Then listens for client commands
    (start, pause, resume, abort) and relays state changes.
    """
    await ws_manager.connect(run_id, websocket)

    try:
        # Send current state on connect
        try:
            run = engine.get_run_state(run_id)
        except (InvalidStateTransition, TestRunNotFound, TestRunNotActive):
            try:
                run = await engine.load_existing_run(run_id)
            except InvalidStateTransition:
                # Terminal run — load from DB as read-only
                run = await _load_terminal_run_ws(run_id)
                if run is None:
                    await ws_manager.send_personal(
                        websocket, ws_manager.error(run_id, f"Run {run_id} not found")
                    )
                    ws_manager.disconnect(run_id, websocket)
                    return
            except (TestRunNotFound, TestRunNotActive):
                await ws_manager.send_personal(
                    websocket, ws_manager.error(run_id, f"Run {run_id} not found")
                )
                ws_manager.disconnect(run_id, websocket)
                return

        # Send initial state
        await ws_manager.send_personal(
            websocket, ws_manager.state_change(run_id, run.status)
        )
        await ws_manager.send_personal(
            websocket,
            ws_manager.progress(run_id, run.current_step_index, run.total_steps),
        )

        # Send current step info
        try:
            current = engine.get_current_step(run_id)
            if current:
                await ws_manager.send_personal(
                    websocket,
                    ws_manager.step_start(run_id, run.current_step_index, current),
                )
        except TestRunNotActive:
            pass

        # Send current execution mode
        mode_info = get_run_mode(run_id)
        await ws_manager.send_personal(
            websocket,
            {"type": "mode_change", "run_id": run_id, **mode_info},
        )

        # Send existing step results
        for i, step in enumerate(run.steps):
            if step.result is not None:
                await ws_manager.send_personal(
                    websocket,
                    ws_manager.step_result(
                        run_id, i, step,
                        {"measured_value": None, "pass_fail": step.result},
                    ),
                )

        # If the DB says the run is 'running' but no execution task is
        # currently alive (e.g. the server was restarted while the run was
        # in flight, or the previous WS connection crashed), restart the
        # execution loop now so the operator's Take Measurement clicks have
        # something to trigger. Without this, trigger_step() silently
        # returns False because _step_triggers[run_id] doesn't exist.
        if run.status == "running" and not has_running_task(run_id):
            await start_execution(engine, run_id)

        # If execution loop is already waiting for a manual trigger (e.g. test
        # was started via REST before this WS client connected), re-send the
        # waiting_for_trigger message so the UI enables the Take button.
        if is_waiting_for_trigger(run_id):
            await ws_manager.send_personal(
                websocket,
                {
                    "type": "waiting_for_trigger",
                    "run_id": run_id,
                    "message": "Waiting for manual measurement trigger",
                },
            )

        # Listen for commands
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "command":
                action = data.get("action")
                try:
                    if action == "start":
                        run = await engine.start_run(run_id)
                        await ws_manager.broadcast(
                            run_id, ws_manager.state_change(run_id, run.status)
                        )
                        # Kick off the step execution loop
                        await start_execution(engine, run_id)

                    elif action == "pause":
                        run = await engine.pause_run(run_id)
                        await ws_manager.broadcast(
                            run_id, ws_manager.state_change(run_id, run.status)
                        )

                    elif action == "resume":
                        run = await engine.resume_run(run_id)
                        await ws_manager.broadcast(
                            run_id, ws_manager.state_change(run_id, run.status)
                        )
                        # Re-check if execution task is still alive, restart if needed
                        await start_execution(engine, run_id)

                    elif action == "abort":
                        cancel_execution(run_id)
                        run = await engine.abort_run(run_id)
                        await ws_manager.broadcast(
                            run_id, ws_manager.state_change(run_id, run.status)
                        )

                    elif action == "take":
                        # Fire the trigger if pending; silently ignore if
                        # the execution loop hasn't reached the wait yet —
                        # the user can simply click again.
                        trigger_step(run_id)

                    elif action == "retake":
                        # Go back one step, clear its result, and re-execute
                        state = engine.get_run_state(run_id)
                        old_idx = state.current_step_index
                        cancel_execution(run_id)
                        step, idx = engine.retake_previous_step(run_id)
                        if step:
                            # Clear the retaken step on clients
                            await ws_manager.broadcast(
                                run_id,
                                ws_manager.step_result(
                                    run_id, idx, step,
                                    {"measured_value": None, "pass_fail": None},
                                ),
                            )
                            # Also clear the step that was "running" before
                            if old_idx < state.total_steps:
                                old_step = state.steps[old_idx]
                                old_step.result = None
                                await ws_manager.broadcast(
                                    run_id,
                                    ws_manager.step_result(
                                        run_id, old_idx, old_step,
                                        {"measured_value": None, "pass_fail": None},
                                    ),
                                )
                            # Restart execution from the rewound position
                            await start_execution(engine, run_id)

                    elif action == "restart":
                        # Cancel current execution, reset to step 0, restart
                        cancel_execution(run_id)
                        run = engine.restart_run(run_id)
                        await ws_manager.broadcast(
                            run_id, ws_manager.state_change(run_id, run.status)
                        )
                        # Send full step reset to clients
                        for i, step in enumerate(run.steps):
                            await ws_manager.broadcast(
                                run_id,
                                ws_manager.step_result(
                                    run_id, i, step,
                                    {"measured_value": None, "pass_fail": None},
                                ),
                            )
                        # Restart execution loop
                        await start_execution(engine, run_id)

                    elif action == "set_mode":
                        mode = data.get("mode", "manual")
                        delay = float(data.get("delay", 0))
                        result = set_run_mode(run_id, mode, delay)
                        await ws_manager.broadcast(
                            run_id,
                            {"type": "mode_change", "run_id": run_id, **result},
                        )

                    else:
                        await ws_manager.send_personal(
                            websocket,
                            ws_manager.error(run_id, f"Unknown action: {action}"),
                        )

                except (InvalidStateTransition, TestRunNotFound, TestRunNotActive) as e:
                    await ws_manager.send_personal(
                        websocket, ws_manager.error(run_id, str(e))
                    )

    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(run_id, websocket)
