"""Authentication router: login, token refresh, and user info endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status

import dbx
from config import settings
from auth.dependencies import get_current_user
from auth.models import LoginRequest, Token, UserInDB
from services.audit import log_audit
from auth.utils import (
    create_access_token,
    create_refresh_token,
    verify_password,
)
from jose import JWTError, jwt
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RefreshRequest(BaseModel):
    """Request body for the token refresh endpoint."""

    refresh_token: str


@router.post("/login", response_model=Token)
async def login(request: LoginRequest) -> Token:
    """Authenticate a user and return access + refresh tokens."""
    async with dbx.connect() as db:
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
    """Return the authenticated user's profile + the pages/features their
    role may access (so the frontend can gate routes + the sidebar)."""
    from services.rbac import get_allowed_pages, SUPER_ADMIN, ADMIN

    # super_admin / admin see everything; the frontend treats an empty list +
    # is_super/is_admin flags as "all". For other roles we return the explicit
    # grants from role_pages.
    allowed_pages: list[str] = []
    if current_user.role not in (SUPER_ADMIN, ADMIN):
        allowed_pages = await get_allowed_pages(current_user.role)

    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "role": current_user.role,
        "badge_id": current_user.badge_id,
        "is_active": current_user.is_active,
        "is_super_admin": current_user.role == SUPER_ADMIN,
        "is_admin": current_user.role in (SUPER_ADMIN, ADMIN),
        "allowed_pages": allowed_pages,
        "created_at": current_user.created_at.isoformat()
        if hasattr(current_user.created_at, "isoformat")
        else str(current_user.created_at),
    }
