"""Roles & access management — super_admin only.

Endpoints (all under /api):
  GET    /roles                 — list roles with grant counts
  POST   /roles                 — create a custom role
  PATCH  /roles/{name}          — update label/description/rank
  DELETE /roles/{name}          — delete a non-system role
  GET    /roles/{name}          — role + its granted pages  ({success,data:{pages}})
  PUT    /roles/{name}/pages    — replace the role's page/feature grants
  GET    /app-pages             — the page+feature registry the UI can grant
  GET    /profiles              — list users
  PATCH  /profiles/{id}/role    — assign a role to a user
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

import dbx
from auth.dependencies import get_current_user
from auth.models import UserInDB
from services.audit import log_audit
from services.rbac import require_super_admin, get_allowed_pages, SUPER_ADMIN


router = APIRouter(prefix="/api", tags=["roles"], dependencies=[Depends(get_current_user)])


class RoleCreate(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,40}$")
    label: str
    description: str | None = None
    rank: int = 30


class RoleUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    rank: int | None = None


class PagesBody(BaseModel):
    pages: list[str]


class RoleAssign(BaseModel):
    role: str


# ---------------------------------------------------------------------------
# Read endpoints — any authenticated user can read the catalogue/registry,
# but only super_admin can read another role's full grant list via /roles/{name}
# is allowed for everyone (the frontend AuthProvider needs its own pages).
# ---------------------------------------------------------------------------


@router.get("/roles")
async def list_roles():
    async with dbx.connect() as db:
        cur = await db.execute(
            """
            SELECT r.name, r.label, r.description, r.is_system, r.rank,
                   COUNT(rp.page_path) AS grant_count
            FROM roles r
            LEFT JOIN role_pages rp ON rp.role_name = r.name
            GROUP BY r.name, r.label, r.description, r.is_system, r.rank
            ORDER BY r.rank DESC
            """
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/roles/{name}")
async def get_role(name: str):
    """Return a role + its granted page paths. Shape matches the frontend
    AuthProvider's expectation: {success, data:{pages}}."""
    pages = await get_allowed_pages(name)
    async with dbx.connect() as db:
        cur = await db.execute("SELECT * FROM roles WHERE name = ?", (name,))
        role = await cur.fetchone()
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "role not found")
    return {"success": True, "data": {"role": dict(role), "pages": pages}}


@router.get("/app-pages")
async def list_app_pages():
    async with dbx.connect() as db:
        cur = await db.execute(
            "SELECT path, label, kind, sort_order FROM app_pages ORDER BY sort_order"
        )
        return [dict(r) for r in await cur.fetchall()]


@router.get("/profiles")
async def list_profiles(user: UserInDB = Depends(require_super_admin())):
    async with dbx.connect() as db:
        cur = await db.execute(
            "SELECT id, username, full_name, email, role, is_active, created_at "
            "FROM profiles ORDER BY username"
        )
        return [dict(r) for r in await cur.fetchall()]


# ---------------------------------------------------------------------------
# Write endpoints — super_admin only
# ---------------------------------------------------------------------------


@router.post("/roles", dependencies=[Depends(require_super_admin())])
async def create_role(body: RoleCreate, user: UserInDB = Depends(get_current_user)):
    async with dbx.connect() as db:
        cur = await db.execute("SELECT 1 FROM roles WHERE name = ?", (body.name,))
        if await cur.fetchone():
            raise HTTPException(status.HTTP_409_CONFLICT, "role already exists")
        await db.execute(
            "INSERT INTO roles (name, label, description, is_system, rank) "
            "VALUES (?, ?, ?, false, ?)",
            (body.name, body.label, body.description, body.rank),
        )
        await db.commit()
    await log_audit(user.id, "role_create", "role", None, body.name)
    return {"name": body.name, "label": body.label, "rank": body.rank}


@router.patch("/roles/{name}", dependencies=[Depends(require_super_admin())])
async def update_role(name: str, body: RoleUpdate, user: UserInDB = Depends(get_current_user)):
    sets, vals = [], []
    for col in ("label", "description", "rank"):
        v = getattr(body, col)
        if v is not None:
            sets.append(f"{col} = ?")
            vals.append(v)
    if not sets:
        return {"updated": 0}
    vals.append(name)
    async with dbx.connect() as db:
        await db.execute(f"UPDATE roles SET {', '.join(sets)} WHERE name = ?", vals)
        await db.commit()
    await log_audit(user.id, "role_update", "role", None, name)
    return {"updated": name}


@router.delete("/roles/{name}", dependencies=[Depends(require_super_admin())])
async def delete_role(name: str, user: UserInDB = Depends(get_current_user)):
    async with dbx.connect() as db:
        cur = await db.execute("SELECT is_system FROM roles WHERE name = ?", (name,))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "role not found")
        if row["is_system"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "cannot delete a system role")
        cur = await db.execute("SELECT COUNT(*) AS c FROM profiles WHERE role = ?", (name,))
        if (await cur.fetchone())["c"] > 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "role is assigned to one or more users; reassign them first",
            )
        await db.execute("DELETE FROM roles WHERE name = ?", (name,))
        await db.commit()
    await log_audit(user.id, "role_delete", "role", None, name)
    return {"deleted": name}


@router.put("/roles/{name}/pages", dependencies=[Depends(require_super_admin())])
async def set_role_pages(name: str, body: PagesBody, user: UserInDB = Depends(get_current_user)):
    if name == SUPER_ADMIN:
        raise HTTPException(status.HTTP_409_CONFLICT, "super_admin grants are fixed")
    async with dbx.connect() as db:
        cur = await db.execute("SELECT 1 FROM roles WHERE name = ?", (name,))
        if not await cur.fetchone():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "role not found")
        await db.execute("DELETE FROM role_pages WHERE role_name = ?", (name,))
        for p in body.pages:
            await db.execute(
                "INSERT INTO role_pages (role_name, page_path) VALUES (?, ?)",
                (name, p),
            )
        await db.commit()
    await log_audit(user.id, "role_pages_set", "role", None, f"{name}: {len(body.pages)} grants")
    return {"role": name, "pages": body.pages}


@router.patch("/profiles/{profile_id}/role", dependencies=[Depends(require_super_admin())])
async def assign_role(profile_id: str, body: RoleAssign, user: UserInDB = Depends(get_current_user)):
    async with dbx.connect() as db:
        cur = await db.execute("SELECT 1 FROM roles WHERE name = ?", (body.role,))
        if not await cur.fetchone():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown role")
        await db.execute(
            "UPDATE profiles SET role = ? WHERE id = ?", (body.role, profile_id)
        )
        await db.commit()
    await log_audit(user.id, "profile_role_assign", "profile", None, f"{profile_id} -> {body.role}")
    return {"profile_id": profile_id, "role": body.role}
