"""Application configuration for TPS-703 ATP system."""

import os
from pathlib import Path


# Auto-load .env files at import time so os.environ is populated before any
# downstream service reads it. Search order (first one found wins per key):
#   1. backend/.env                            (project-local override)
#   2. backend/../.env                         (repo root)
#   3. ~/Desktop/.env.local                    (user-global config — used here for shared
#                                               keys like GROQ_API_KEY, ANTHROPIC_API_KEY, etc.)
# python-dotenv's load_dotenv() is a no-op when the file is missing.
try:
    from dotenv import load_dotenv

    _backend_dir = Path(__file__).resolve().parent
    for _candidate in (
        _backend_dir / ".env",
        _backend_dir.parent / ".env",
        Path.home() / "Desktop" / ".env.local",
    ):
        if _candidate.is_file():
            load_dotenv(_candidate, override=False)
except ImportError:
    # python-dotenv is in requirements.txt; if it's missing the project just
    # falls back to whatever the launching shell exported, so we don't crash.
    pass


class Settings:
    """Application settings."""

    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
    # Supabase Postgres connection string (asyncpg DSN). Required at runtime.
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    CORS_ORIGINS: list = [
        o.strip()
        for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]
    ALGORITHM: str = "HS256"


settings = Settings()
