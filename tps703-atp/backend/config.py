"""Application configuration for TPS-703 ATP system."""

import os


class Settings:
    """Application settings."""

    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
    DB_PATH: str = os.environ.get("DB_PATH", "atp.db")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    CORS_ORIGINS: list = [
        o.strip()
        for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]
    ALGORITHM: str = "HS256"


settings = Settings()
