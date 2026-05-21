"""Pydantic models for authentication and user management."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UserBase(BaseModel):
    """Base user fields shared across create/read models."""

    username: str
    full_name: str
    # Roles are now DB-driven (super_admin, admin, engineer, technician,
    # viewer + any custom role), so we no longer hard-code a pattern here.
    role: str = Field(..., description="Role name (validated against the roles table)")
    badge_id: Optional[str] = None


class UserCreate(UserBase):
    """Model for creating a new user (includes plaintext password)."""

    password: str


class UserInDB(UserBase):
    """User as stored in the database (includes hashed password).

    ``id`` is the ``uuid`` string from ``profiles.id`` on Supabase Postgres.
    Typed as ``int | str`` so legacy integer-keyed rows still validate.
    """

    id: int | str
    password_hash: str
    is_active: bool = True
    created_at: datetime | str


class Token(BaseModel):
    """JWT token pair returned on login/refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Data extracted from a decoded JWT."""

    username: Optional[str] = None
    role: Optional[str] = None


class LoginRequest(BaseModel):
    """Request body for the login endpoint."""

    username: str
    password: str
