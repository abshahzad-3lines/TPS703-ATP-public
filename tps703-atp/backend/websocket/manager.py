"""WebSocket connection manager for live test data streaming."""

from datetime import datetime, timezone

from fastapi import WebSocket


class ConnectionManager:
    """Manages WebSocket connections grouped by test run ID."""

    def __init__(self):
        self._connections: dict[int, set[WebSocket]] = {}

    async def connect(self, run_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        if run_id not in self._connections:
            self._connections[run_id] = set()
        self._connections[run_id].add(websocket)

    def disconnect(self, run_id: int, websocket: WebSocket) -> None:
        conns = self._connections.get(run_id)
        if conns:
            conns.discard(websocket)
            if not conns:
                del self._connections[run_id]

    async def broadcast(self, run_id: int, message: dict) -> None:
        """Send a JSON message to all connections for a given run."""
        conns = self._connections.get(run_id, set()).copy()
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(run_id, ws)

    async def send_personal(self, websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    def get_connection_count(self, run_id: int) -> int:
        return len(self._connections.get(run_id, set()))

    # --- Message builders ---

    @staticmethod
    def state_change(run_id: int, status: str) -> dict:
        return {
            "type": "state_change",
            "run_id": run_id,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def step_start(run_id: int, step_index: int, step) -> dict:
        return {
            "type": "step_start",
            "run_id": run_id,
            "step_index": step_index,
            "step_number": step.step_number,
            "step_name": step.name,
            "step_type": step.step_type,
            "instrument": step.instrument,
        }

    @staticmethod
    def step_result(run_id: int, step_index: int, step, result: dict) -> dict:
        return {
            "type": "step_result",
            "run_id": run_id,
            "step_index": step_index,
            "step_number": step.step_number,
            "step_name": step.name,
            "measured_value": result.get("measured_value"),
            "pass_fail": result.get("pass_fail"),
            "unit": step.unit,
            "limit_min": step.limit_min,
            "limit_max": step.limit_max,
        }

    @staticmethod
    def progress(run_id: int, completed: int, total: int) -> dict:
        return {
            "type": "progress",
            "run_id": run_id,
            "completed_steps": completed,
            "total_steps": total,
            "percent": round((completed / total) * 100, 1) if total > 0 else 0,
        }

    @staticmethod
    def instrument_reading(run_id: int, instrument: str, data: dict) -> dict:
        return {
            "type": "instrument_reading",
            "run_id": run_id,
            "instrument": instrument,
            "data": data,
        }

    @staticmethod
    def error(run_id: int, message: str) -> dict:
        return {
            "type": "error",
            "run_id": run_id,
            "message": message,
        }


# Singleton
ws_manager = ConnectionManager()
