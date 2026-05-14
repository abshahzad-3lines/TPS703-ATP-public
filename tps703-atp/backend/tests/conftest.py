"""Shared fixtures for TPS-703 ATP backend tests.

Provides a temporary SQLite database (file-based in a temp directory) that is
initialised with the full schema and seed data before each test session.

Also patches ``asyncio.sleep`` globally so that simulated instrument delays
are near-instant, keeping the full test suite fast.
"""

import asyncio
import os
import sys
import tempfile
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

# Ensure the backend package root is on sys.path so that bare imports
# (e.g. ``from config import settings``) resolve correctly.
_backend_dir = os.path.join(os.path.dirname(__file__), os.pardir)
sys.path.insert(0, os.path.abspath(_backend_dir))

from config import settings  # noqa: E402


# ---------------------------------------------------------------------------
# Patch asyncio.sleep so simulated instrument delays are near-instant
# ---------------------------------------------------------------------------
_real_sleep = asyncio.sleep


async def _fast_sleep(delay, *args, **kwargs):
    """Replace asyncio.sleep with a near-zero delay to speed up tests."""
    await _real_sleep(0)


# Apply the patch at module level so it takes effect for all tests
_sleep_patch = patch("asyncio.sleep", side_effect=_fast_sleep)
_sleep_patch.start()


@pytest_asyncio.fixture(scope="session")
async def temp_db():
    """Create a temporary SQLite database with schema + seed data.

    The fixture patches ``config.settings.DB_PATH`` and
    ``database.DB_PATH`` so that all production code automatically
    uses the temporary database.

    Yields the path to the temporary database file and cleans up
    afterwards.
    """
    tmp = tempfile.mkdtemp(prefix="atp_test_")
    db_path = os.path.join(tmp, "test_atp.db")

    # Patch settings BEFORE importing modules that cache DB_PATH at import time.
    original_path = settings.DB_PATH
    settings.DB_PATH = db_path

    # database.py caches DB_PATH at module level — re-import / patch it too.
    import database
    database.DB_PATH = db_path

    # Initialise schema
    await database.init_db()

    # Seed subsystems, procedures, and test steps
    import aiosqlite
    from seed_data import seed_all

    async with aiosqlite.connect(db_path) as db:
        await seed_all(db)

    # Seed a test user (needed for foreign-key references like started_by)
    async with aiosqlite.connect(db_path) as db:
        await db.execute(
            """INSERT OR IGNORE INTO users
               (id, username, password_hash, role, full_name, badge_id)
               VALUES (1, 'testuser', 'fakehash', 'engineer', 'Test User', 'T001')"""
        )
        await db.commit()

    yield db_path

    # Restore original settings
    settings.DB_PATH = original_path
    database.DB_PATH = original_path

    # Clean up temp file
    try:
        os.remove(db_path)
        os.rmdir(tmp)
    except OSError:
        pass


@pytest.fixture(autouse=True)
def _ensure_db_path(temp_db):
    """Ensure every test uses the temporary DB (auto-use fixture).

    This runs before each test to guarantee the patched path is active
    even when modules are re-imported.
    """
    settings.DB_PATH = temp_db
    import database
    database.DB_PATH = temp_db
