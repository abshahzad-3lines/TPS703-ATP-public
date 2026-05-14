"""Pydantic models for authentication and user management."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UserBase(BaseModel):
    """Base user fields shared across create/read models."""

    username: str
    full_name: str
    role: str = Field(
        ..., pattern="^(admin|engineer|technician|viewer)$",
        description="User role: admin, engineer, technician, or viewer"
    )
    badge_id: Optional[str] = None


class UserCreate(UserBase):
    """Model for creating a new user (includes plaintext password)."""

    password: str


class UserInDB(UserBase):
    """User as stored in the database (includes hashed password)."""

    id: int
    password_hash: str
    is_active: bool = True
    created_at: datetime


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
