"""Database connection helpers for the TPS-703 ATP system.

The schema lives entirely in ``supabase/migrations/`` and is applied to the
Supabase Postgres project out-of-band (via the Supabase CLI). The app never
creates tables at runtime — ``init_db`` is a no-op kept only so the FastAPI
lifespan hook has a stable symbol to call.
"""

import dbx


async def get_db_connection():
    """Return a Supabase Postgres connection (via the dbx asyncpg layer)."""
    return await dbx.connect()


async def init_db() -> None:
    """No-op: the schema is owned by supabase/migrations/."""
    print("DB backend = postgres; schema owned by supabase/migrations/")
