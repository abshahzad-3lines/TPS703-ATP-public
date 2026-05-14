"""Tests for the Equipment Bench endpoints (single-shot, simulator, raw SCPI)
and the bench WebSocket stream.
"""

import asyncio
import os
import sys

import aiosqlite
import pytest
import pytest_asyncio

# Ensure bare imports resolve when running from backend/
_backend_dir = os.path.join(os.path.dirname(__file__), os.pardir)
sys.path.insert(0, os.path.abspath(_backend_dir))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def bench_app(temp_db):
    """Build a FastAPI app exposing both equipment routers + the bench WS."""
    from fastapi import FastAPI, WebSocket

    from routers import equipment as equipment_router
    from routers import equipment_bench as bench_router

    app = FastAPI()
    app.include_router(equipment_router.router)
    app.include_router(bench_router.router)

    @app.websocket("/ws/equipment/{equipment_id}")
    async def _ws(websocket: WebSocket, equipment_id: int):
        await bench_router._run_bench_websocket(websocket, equipment_id)

    return app


def _auth_header() -> dict[str, str]:
    """Mint a Bearer token for the seeded test user (role=engineer)."""
    from auth.utils import create_access_token

    token = create_access_token({"sub": "testuser"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sim_equipment_id(temp_db):
    """Insert a simulator-mode equipment row and return its id (sync)."""
    import sqlite3

    conn = sqlite3.connect(temp_db)
    try:
        cursor = conn.execute(
            """
            INSERT INTO equipment
                (name, model, manufacturer, serial_number,
                 connection_type, connection_address, is_active, instrument_role)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                "Bench Sim DMM",
                "SIM-DMM",
                "TPS-703",
                "BENCH-001",
                "simulator",
                None,
                "multimeter",
            ),
        )
        eq_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()
    return eq_id


# ---------------------------------------------------------------------------
# /simulate — simulator-only reading
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_simulate_endpoint_returns_value(bench_app):
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=bench_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/equipment/simulate",
            headers=_auth_header(),
            json={"step_type": "current", "params": {"limit_max": 9.0}},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "simulator"
    assert isinstance(body["value"], (int, float))
    assert "timestamp" in body


# ---------------------------------------------------------------------------
# /measure — live (simulator-mode equipment)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_measure_endpoint_returns_live_source(
    bench_app, sim_equipment_id
):
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=bench_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/equipment/{sim_equipment_id}/measure",
            headers=_auth_header(),
            json={"step_type": "resistance", "params": {"limit_nominal": 3.15, "limit_tolerance": 0.1}},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["source"] == "live"
    assert isinstance(body["value"], (int, float))


@pytest.mark.asyncio
async def test_measure_handles_multiple_step_types(bench_app, sim_equipment_id):
    """Verify that 3 different step types all return realistic values."""
    from httpx import ASGITransport, AsyncClient

    cases = [
        ("output_power", {"limit_min": 58.6}),
        ("return_loss", {"limit_max": -11.0}),
        ("pulse_width", {"limit_nominal": 251.0, "limit_tolerance": 5.0}),
    ]

    transport = ASGITransport(app=bench_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for step_type, params in cases:
            resp = await client.post(
                f"/api/equipment/{sim_equipment_id}/measure",
                headers=_auth_header(),
                json={"step_type": step_type, "params": params},
            )
            assert resp.status_code == 200, f"{step_type}: {resp.text}"
            body = resp.json()
            assert body["source"] == "live"
            assert body["value"] is not None


@pytest.mark.asyncio
async def test_measure_404_on_unknown_equipment(bench_app):
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=bench_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/equipment/99999/measure",
            headers=_auth_header(),
            json={"step_type": "voltage", "params": {}},
        )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /scpi — raw SCPI commands and audit logging
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scpi_query_returns_idn(bench_app, sim_equipment_id, temp_db):
    """*IDN? should return the simulator's stub response."""
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=bench_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/equipment/{sim_equipment_id}/scpi",
            headers=_auth_header(),
            json={"command": "*IDN?", "is_query": True},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["error"] is None
    assert body["response"] == "TPS-703 ATP Simulator,SIM001,v1.0,0"


@pytest.mark.asyncio
async def test_scpi_send_writes_audit_log(bench_app, sim_equipment_id, temp_db):
    """A non-query SCPI command should write a row to audit_log."""
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=bench_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/equipment/{sim_equipment_id}/scpi",
            headers=_auth_header(),
            json={"command": "*RST", "is_query": False},
        )
    assert resp.status_code == 200, resp.text

    # log_audit fires-and-forgets via asyncio.create_task — give it a tick
    for _ in range(20):
        await asyncio.sleep(0)
        async with aiosqlite.connect(temp_db) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM audit_log WHERE action='scpi' AND entity_id=?",
                (sim_equipment_id,),
            )
            rows = await cursor.fetchall()
        if rows:
            break

    assert len(rows) >= 1
    assert "*RST" in (rows[-1]["details"] or "")


# ---------------------------------------------------------------------------
# /ws/equipment/{id} — streaming bench WebSocket
# ---------------------------------------------------------------------------


def _build_bench_app():
    """Inline copy of the bench_app fixture so pytest doesn't auto-wrap it."""
    from fastapi import FastAPI, WebSocket
    from routers import equipment as equipment_router
    from routers import equipment_bench as bench_router

    app = FastAPI()
    app.include_router(equipment_router.router)
    app.include_router(bench_router.router)

    @app.websocket("/ws/equipment/{equipment_id}")
    async def _ws(websocket: WebSocket, equipment_id: int):
        await bench_router._run_bench_websocket(websocket, equipment_id)

    return app


def test_bench_ws_smoke():
    """Bare-minimum WS smoke test — no fixtures."""
    from fastapi.testclient import TestClient

    bench_app = _build_bench_app()
    with TestClient(bench_app) as client:
        with client.websocket_connect("/ws/equipment/9999") as ws:
            ws.send_json({"type": "stop_stream"})
            msg = ws.receive_json()
            assert msg.get("type") in ("stream_state", "error")


def test_bench_ws_streams_live_and_simulator_readings(sim_equipment_id):
    """start_stream → at least one live + one simulator reading; stop_stream closes cleanly."""
    from fastapi.testclient import TestClient

    bench_app = _build_bench_app()
    with TestClient(bench_app) as client:
        with client.websocket_connect(
            f"/ws/equipment/{sim_equipment_id}"
        ) as ws:
            ws.send_json(
                {
                    "type": "start_stream",
                    "step_type": "voltage",
                    "params": {"limit_nominal": 5.0, "limit_tolerance": 0.1},
                    "interval_ms": 100,
                    "include_simulator": True,
                }
            )

            seen_live = False
            seen_sim = False
            running_ack = False
            for _ in range(30):
                msg = ws.receive_json()
                t = msg.get("type")
                if t == "stream_state" and msg.get("running") is True:
                    running_ack = True
                if t == "reading":
                    if msg.get("source") == "live":
                        seen_live = True
                    elif msg.get("source") == "simulator":
                        seen_sim = True
                if seen_live and seen_sim and running_ack:
                    break

            assert running_ack, "did not receive stream_state running=True"
            assert seen_live, "expected at least one live reading"
            assert seen_sim, "expected at least one simulator reading"

            ws.send_json({"type": "stop_stream"})
            # Drain until we see the stopped ack
            stopped = False
            for _ in range(30):
                msg = ws.receive_json()
                if msg.get("type") == "stream_state" and msg.get("running") is False:
                    stopped = True
                    break
            assert stopped, "did not receive stream_state running=False after stop"


def test_bench_ws_scpi_query_through_websocket(sim_equipment_id):
    """The WebSocket scpi message returns a scpi_response."""
    from fastapi.testclient import TestClient

    bench_app = _build_bench_app()
    with TestClient(bench_app) as client:
        with client.websocket_connect(
            f"/ws/equipment/{sim_equipment_id}"
        ) as ws:
            ws.send_json({"type": "scpi", "command": "*IDN?", "is_query": True})
            for _ in range(10):
                msg = ws.receive_json()
                if msg.get("type") == "scpi_response":
                    assert msg.get("error") is None
                    assert "Simulator" in (msg.get("response") or "")
                    break
            else:
                pytest.fail("did not receive scpi_response")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
