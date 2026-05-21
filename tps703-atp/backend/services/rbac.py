"""DB-driven RBAC — page/feature access from the role_pages table.

Mirrors the ai-command-center model:
  * super_admin — bypasses every check.
  * admin       — bypasses application *page* checks, but NOT
                  'manage-roles' (only super_admin manages roles).
  * everyone else — must have the matching row in role_pages
                    (a page path like '/sparam' or a feature flag
                    'feature:atp-approve').

These helpers are backend-only and read through the dbx shim, so they
work on both SQLite and Supabase Postgres.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

import dbx
from auth.dependencies import get_current_user
from auth.models import UserInDB


SUPER_ADMIN = "super_admin"
ADMIN = "admin"


async def get_allowed_pages(role: str) -> list[str]:
    """Return every page_path (incl. feature: flags) granted to a role."""
    async with dbx.connect() as db:
        cur = await db.execute(
            "SELECT page_path FROM role_pages WHERE role_name = ?", (role,)
        )
        rows = await cur.fetchall()
    return [r["page_path"] for r in rows]


async def role_exists(role: str) -> bool:
    async with dbx.connect() as db:
        cur = await db.execute("SELECT 1 FROM roles WHERE name = ?", (role,))
        return await cur.fetchone() is not None


async def can_access_page(user: UserInDB, path: str) -> bool:
    if user.role == SUPER_ADMIN:
        return True
    if user.role == ADMIN and path != "/roles":
        return True
    return path in await get_allowed_pages(user.role)


async def can_access_feature(user: UserInDB, feature: str) -> bool:
    key = feature if feature.startswith("feature:") else f"feature:{feature}"
    if user.role == SUPER_ADMIN:
        return True
    if user.role == ADMIN and key != "feature:manage-roles":
        return True
    return key in await get_allowed_pages(user.role)


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


def require_page(path: str):
    async def _dep(user: UserInDB = Depends(get_current_user)) -> UserInDB:
        if not await can_access_page(user, path):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{user.role}' has no access to page '{path}'.",
            )
        return user
    return _dep


def require_feature(feature: str):
    async def _dep(user: UserInDB = Depends(get_current_user)) -> UserInDB:
        if not await can_access_feature(user, feature):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{user.role}' lacks feature '{feature}'.",
            )
        return user
    return _dep


def require_super_admin():
    async def _dep(user: UserInDB = Depends(get_current_user)) -> UserInDB:
        if user.role != SUPER_ADMIN:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This action requires the super_admin role.",
            )
        return user
    return _dep
