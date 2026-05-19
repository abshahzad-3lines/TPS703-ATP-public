"""TPS-703 ATP Automation System — FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import get_db_connection, init_db
from seed_data import seed_all
from services.equipment_autoregister import reconcile_equipment_with_network
from auth.router import router as auth_router
from routers.subsystems import router as subsystems_router
from routers.uuts import router as uuts_router
from routers.calibrations import router as calibrations_router
from routers.test_runs import router as test_runs_router
from routers.exports import router as exports_router
from routers.audit import router as audit_router
from routers.results import router as results_router
from routers.equipment import router as equipment_router
from routers.equipment_bench import router as equipment_bench_router
from routers.equipment_bench import ws_router as equipment_bench_ws_router
from routers.analytics import router as analytics_router
from routers.atp import router as atp_router
from routers.sparam import router as sparam_router
from websocket.routes import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown events."""
    print("ATP System starting")
    await init_db()
    db = await get_db_connection()
    await seed_all(db)
    await db.close()
    # Reconcile the equipment table against what is actually reachable on
    # this PC's network — runs BLOCKING (not background) so the table is
    # guaranteed to be clean before uvicorn starts accepting requests.
    # The cost is a one-time ~3-5 second pause during startup; the win is
    # that no UI request or WebSocket can ever open a driver against a
    # stale ``connection_address`` (e.g. cached 169.254.* IPs from a
    # different bench). Three passes inside:
    #   1. Probe every active row's address with a 1.5 s connect — drop
    #      rows that don't answer.
    #   2. Discover via PyVISA + mDNS, heal addresses by *IDN? serial.
    #   3. Deactivate active rows whose serial wasn't discovered.
    # Result: every is_active=1 row at the end is either probe-reachable
    # or freshly healed. Discovery failures are swallowed (rows from
    # pass 1 still survive).
    try:
        stats = await reconcile_equipment_with_network(mdns_timeout=3.0)
        print(
            f"Equipment reconcile complete: discovered={stats['discovered']} "
            f"unreachable={stats['unreachable']} healed={stats['healed']} "
            f"inserted={stats['inserted']} deactivated={stats['deactivated']}"
        )
    except Exception as exc:  # noqa: BLE001
        # Never block server startup on a reconcile bug.
        print(f"Equipment reconcile errored (non-fatal): {exc}")
    yield
    print("ATP System shutting down")


app = FastAPI(
    title="TPS-703 ATP Automation System",
    description="Acceptance Test Procedure automation for TPS-703 radar transmitter subsystems",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(subsystems_router)
app.include_router(uuts_router)
app.include_router(calibrations_router)
app.include_router(test_runs_router)
app.include_router(exports_router)
app.include_router(audit_router)
app.include_router(results_router)
app.include_router(equipment_router)
app.include_router(equipment_bench_router)
app.include_router(equipment_bench_ws_router)
app.include_router(analytics_router)
app.include_router(atp_router)
app.include_router(sparam_router)
app.include_router(ws_router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "system": "TPS-703 ATP"}


# ---------------------------------------------------------------------------
# Production static file serving
# ---------------------------------------------------------------------------
# When the frontend has been built and copied into a 'static' directory next
# to this file (e.g. by the Dockerfile), serve it directly from FastAPI.
# In development the Vite dev server proxies /api and /ws to the backend,
# so this block is skipped when the static directory does not exist.
# ---------------------------------------------------------------------------

_static_dir = Path(__file__).resolve().parent / "static"

if _static_dir.is_dir():
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    # Serve static assets (JS, CSS, images, etc.) under /assets and root files
    app.mount("/assets", StaticFiles(directory=_static_dir / "assets"), name="assets")

    # Catch-all: return index.html for any path not matched by /api or /ws
    # so that the React SPA router can handle client-side routing.
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA index.html for all non-API, non-WS routes."""
        file_path = _static_dir / full_path
        # If the exact file exists (e.g. favicon.ico, manifest.json), serve it
        if file_path.is_file():
            return FileResponse(file_path)
        # Otherwise, fall back to index.html for SPA routing
        return FileResponse(_static_dir / "index.html")
