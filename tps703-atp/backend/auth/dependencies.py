"""FastAPI dependencies for authentication and role-based access control."""

from typing import Callable

import aiosqlite
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

import dbx
from config import settings
from auth.models import UserInDB

# Role hierarchy — higher index = more privilege
ROLE_HIERARCHY = ["viewer", "technician", "engineer", "admin"]


async def get_current_user(
    authorization: str = Header(..., alias="Authorization"),
) -> UserInDB:
    """Extract and validate the Bearer token, returning the authenticated user.

    Raises:
        HTTPException 401: If the token is missing, malformed, expired, or the
            user does not exist / is inactive.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Expect "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise credentials_exception
    token = parts[1]

    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        username: str | None = payload.get("sub")
        token_type: str | None = payload.get("type")
        if username is None or token_type != "access":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Look up user in the database
    async with dbx.connect() as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        )
        row = await cursor.fetchone()

    if row is None:
        raise credentials_exception

    user = UserInDB(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        role=row["role"],
        badge_id=row["badge_id"],
        password_hash=row["password_hash"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
    )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    return user


def require_role(min_role: str) -> Callable:
    """Return a dependency that enforces a minimum role level.

    Role hierarchy (lowest to highest):
        viewer < technician < engineer < admin

    Usage::

        @router.get("/admin-only", dependencies=[Depends(require_role("admin"))])
        async def admin_endpoint(): ...

    Args:
        min_role: The minimum role required to access the endpoint.

    Returns:
        An async dependency function for FastAPI's Depends().
    """
    min_level = ROLE_HIERARCHY.index(min_role)

    async def _check_role(
        authorization: str = Header(..., alias="Authorization"),
    ) -> UserInDB:
        user = await get_current_user(authorization)
        user_level = ROLE_HIERARCHY.index(user.role)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' insufficient. Requires '{min_role}' or higher.",
            )
        return user

    return _check_role
