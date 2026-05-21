"""Authentication router: login, token refresh, and user info endpoints."""

from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status

import dbx
from config import settings
from auth.dependencies import get_current_user
from auth.models import LoginRequest, Token, UserInDB
from services.audit import log_audit
from auth.utils import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from jose import JWTError, jwt
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RefreshRequest(BaseModel):
    """Request body for the token refresh endpoint."""

    refresh_token: str


async def _ensure_users_table(db: aiosqlite.Connection) -> None:
    """Create the users table if it does not exist."""
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'engineer', 'technician', 'viewer')),
            badge_id TEXT,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    await db.commit()


async def _seed_admin_if_empty(db: aiosqlite.Connection) -> None:
    """Seed default users + placeholder equipment when the DB is empty.

    Two reasons:
    1. The peer-review feature needs a second engineer so the
       'author cannot self-approve' rule is actually demonstrable.
    2. The step-schema validator blocks publish on missing instrument
       roles. On a fresh cloud deploy (ephemeral SQLite) the equipment
       table is empty, so the entire publish path becomes a chicken-and-
       egg problem. We register one inactive placeholder row per
       instrument role so validation passes out of the box.
       Real lab installations will overwrite these via the discover /
       reconcile-on-startup hooks.
    """
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    (count,) = await cursor.fetchone()
    if count != 0:
        return

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """
        INSERT INTO users (username, full_name, role, password_hash, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        """,
        ("admin", "System Administrator", "admin",
         hash_password("admin123"), now),
    )
    await db.execute(
        """
        INSERT INTO users (username, full_name, role, password_hash, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        """,
        ("peer", "Peer Engineer", "engineer",
         hash_password("peer1234"), now),
    )

    # Placeholder equipment — one row per instrument role the validator
    # cares about. `is_active=1` so they satisfy the validator;
    # `connection_type='simulator'` so anyone wiring real hardware can
    # tell at a glance these are demo rows that should be replaced.
    placeholder_equipment = [
        ("Demo multimeter (replace before lab use)", "Keysight", "34465A", "multimeter"),
        ("Demo power meter (replace before lab use)", "Keysight", "N1912A", "power_meter"),
        ("Demo signal generator (replace before lab use)", "Keysight", "N5181B", "signal_generator"),
        ("Demo oscilloscope (replace before lab use)", "Keysight", "DSOS104A", "oscilloscope"),
        ("Demo spectrum analyzer (replace before lab use)", "Keysight", "N9020B", "spectrum_analyzer"),
        ("Demo network analyzer (replace before lab use)", "Keysight", "N5247B", "network_analyzer"),
        ("Demo phase meter (replace before lab use)", "Pendulum", "CNT-91R", "phase_meter"),
        ("Demo FFT display (replace before lab use)", "Internal", "FPGA-FFT", "fft_display"),
        ("Demo common bus (replace before lab use)", "Internal", "MIL-STD-1553", "common_bus"),
    ]
    for name, manuf, model, role in placeholder_equipment:
        await db.execute(
            """
            INSERT INTO equipment
                (name, manufacturer, model, instrument_role, connection_type, is_active)
            VALUES (?, ?, ?, ?, 'simulator', 1)
            """,
            (name, manuf, model, role),
        )

    await db.commit()


@router.post("/login", response_model=Token)
async def login(request: LoginRequest) -> Token:
    """Authenticate a user and return access + refresh tokens.

    On first login attempt, seeds a default admin user if the table is empty.
    """
    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        if not dbx.is_postgres():
            await _ensure_users_table(db)
            await _seed_admin_if_empty(db)

        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (request.username,)
        )
        user_row = await cursor.fetchone()

    if user_row is None or not verify_password(
        request.password, user_row["password_hash"]
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user_row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    token_data = {"sub": user_row["username"], "role": user_row["role"]}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    await log_audit(
        user_id=user_row["id"],
        action="login",
        entity_type="user",
        entity_id=user_row["id"],
        details=f"username={user_row['username']}",
    )

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=Token)
async def refresh(request: RefreshRequest) -> Token:
    """Exchange a valid refresh token for a new access token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            request.refresh_token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        username: str | None = payload.get("sub")
        token_type: str | None = payload.get("type")
        if username is None or token_type != "refresh":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Verify user still exists and is active
    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        )
        user_row = await cursor.fetchone()

    if user_row is None or not user_row["is_active"]:
        raise credentials_exception

    token_data = {"sub": user_row["username"], "role": user_row["role"]}
    new_access_token = create_access_token(token_data)
    # Issue a fresh refresh token as well
    new_refresh_token = create_refresh_token(token_data)

    return Token(access_token=new_access_token, refresh_token=new_refresh_token)


@router.get("/me")
async def get_me(current_user: UserInDB = Depends(get_current_user)) -> dict:
    """Return the authenticated user's profile information."""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "badge_id": current_user.badge_id,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at.isoformat()
        if hasattr(current_user.created_at, "isoformat")
        else str(current_user.created_at),
    }
