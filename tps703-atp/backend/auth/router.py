"""Authentication router: login, token refresh, and user info endpoints."""

from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status

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
    """Seed default admin + peer-engineer users when the users table is empty.

    The peer engineer is needed so the peer-review feature is testable on
    a fresh deploy without operator intervention (the rule is "author
    cannot self-approve", so a single admin can't demonstrate it).
    """
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    (count,) = await cursor.fetchone()
    if count == 0:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            """
            INSERT INTO users (username, full_name, role, password_hash, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (
                "admin",
                "System Administrator",
                "admin",
                hash_password("admin123"),
                now,
            ),
        )
        await db.execute(
            """
            INSERT INTO users (username, full_name, role, password_hash, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (
                "peer",
                "Peer Engineer",
                "engineer",
                hash_password("peer1234"),
                now,
            ),
        )
        await db.commit()


@router.post("/login", response_model=Token)
async def login(request: LoginRequest) -> Token:
    """Authenticate a user and return access + refresh tokens.

    On first login attempt, seeds a default admin user if the table is empty.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
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
    async with aiosqlite.connect(settings.DB_PATH) as db:
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
