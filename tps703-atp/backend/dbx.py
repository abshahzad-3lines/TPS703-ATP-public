"""Supabase Postgres data layer (asyncpg).

Supabase Postgres is the one and only backend. This module exposes
``connect()`` returning a ``PgConnection`` — a thin asyncpg facade that keeps
the connection API the application code is written against:
``await db.execute(sql, params)`` returning a cursor with ``.fetchone()``,
``.fetchall()``, ``.lastrowid``, ``.rowcount``; plus ``.commit()`` /
``.close()`` and ``async with`` support.

The application's SQL is authored in a portable, mostly-ANSI dialect with a
few non-Postgres quirks; ``_translate()`` rewrites those to Postgres on the
fly so the queries did not need a line-by-line rewrite:
  ?                      -> $1, $2, ...     (positional params)
  datetime('now')        -> now()
  INSERT OR IGNORE INTO  -> INSERT INTO ... (ON CONFLICT DO NOTHING appended)
  PRAGMA                 -> no-op (schema lives in supabase/migrations/)
and ``RETURNING id`` is auto-appended to INSERTs so ``cursor.lastrowid`` works.

asyncpg ``Record`` objects support both ``row['col']`` and ``row[0]`` access,
matching how the code reads rows.
"""

from __future__ import annotations

import os
import re

from config import settings

# Constraint-violation exception, for callers that translate it into HTTP 409.
# asyncpg raises subclasses of IntegrityConstraintViolationError (e.g.
# UniqueViolationError).
try:
    from asyncpg.exceptions import IntegrityConstraintViolationError as IntegrityError
    from asyncpg import Record as Row
except Exception:  # noqa: BLE001 — asyncpg unavailable in some tooling contexts
    class IntegrityError(Exception):  # type: ignore[no-redef]
        pass

    Row = object  # type: ignore[assignment,misc]

# ---------------------------------------------------------------------------
# Postgres shim
# ---------------------------------------------------------------------------

_pg_pool = None


async def _init_conn(conn):
    """Per-connection setup: pass uuid columns as plain strings both ways.

    The Python code stores/compares user ids as strings (uuid). Registering a
    text codec for uuid means asyncpg accepts ``str`` params for uuid columns
    and returns uuid values as ``str`` — no casting sprinkled through the app.
    """
    await conn.set_type_codec(
        "uuid", encoder=str, decoder=str, schema="pg_catalog", format="text",
    )
    # Return timestamps/dates as ISO strings so the Pydantic response models
    # that type these fields as `str` keep working.
    for _t in ("timestamptz", "timestamp", "date"):
        await conn.set_type_codec(
            _t, encoder=str, decoder=str, schema="pg_catalog", format="text",
        )


async def _get_pool():
    global _pg_pool
    if _pg_pool is None:
        import asyncpg
        dsn = os.environ.get("DATABASE_URL") or settings.DATABASE_URL
        # statement_cache_size=0 is required for the Supabase transaction
        # pooler (pgbouncer), which can't keep prepared statements alive.
        _pg_pool = await asyncpg.create_pool(
            dsn, min_size=1, max_size=8, statement_cache_size=0,
            init=_init_conn,
        )
    return _pg_pool


def _translate(sql: str) -> str:
    """Rewrite the few non-Postgres dialect bits in app SQL to Postgres."""
    s = sql
    # datetime('now') / CURRENT_TIMESTAMP-ish
    s = s.replace("datetime('now')", "now()")
    # INSERT OR IGNORE
    ignore = False
    m = re.search(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", s, re.IGNORECASE)
    if m:
        s = re.sub(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", "INSERT INTO", s, flags=re.IGNORECASE)
        ignore = True
    # Positional params: ? -> $1, $2, ...
    if "?" in s:
        idx = 0
        out = []
        for ch in s:
            if ch == "?":
                idx += 1
                out.append(f"${idx}")
            else:
                out.append(ch)
        s = "".join(out)
    # Auto ON CONFLICT for translated INSERT OR IGNORE
    if ignore and "ON CONFLICT" not in s.upper():
        s = s.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
    return s


class _PgCursor:
    """Mimics the cursor surface the application code relies on."""

    def __init__(self, rows: list, lastrowid, rowcount: int = -1):
        self._rows = rows
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    async def fetchone(self):
        return self._rows[0] if self._rows else None

    async def fetchall(self):
        return self._rows


class PgConnection:
    """Facade over an asyncpg connection preserving the legacy call style."""

    def __init__(self, conn, pool):
        self._conn = conn
        self._pool = pool
        self.row_factory = None  # accepted + ignored (asyncpg Records are dict-like)

    async def execute(self, sql: str, params: tuple | list = ()):
        # Legacy no-op statements with no Postgres equivalent (e.g. PRAGMA).
        if sql.lstrip().upper().startswith("PRAGMA"):
            return _PgCursor([], None)
        pg_sql = _translate(sql)
        is_insert = pg_sql.lstrip()[:6].upper() == "INSERT"
        has_returning = " RETURNING " in pg_sql.upper()

        # Auto-append RETURNING id so .lastrowid works (skip if ON CONFLICT
        # DO NOTHING, where no row may be returned, or if already present).
        if is_insert and not has_returning and "ON CONFLICT" not in pg_sql.upper():
            pg_sql = pg_sql.rstrip().rstrip(";") + " RETURNING id"
            has_returning = True

        if pg_sql.lstrip()[:6].upper() in ("SELECT", "WITH ") or pg_sql.lstrip()[:4].upper() == "WITH" or has_returning:
            try:
                rows = await self._conn.fetch(pg_sql, *params)
            except Exception as e:  # noqa: BLE001
                # Tables without an `id` column (e.g. roles, role_pages) reject
                # the auto-appended RETURNING id. Retry without it.
                if "RETURNING id" in pg_sql and "id" in str(e).lower():
                    plain = pg_sql.rsplit(" RETURNING id", 1)[0]
                    await self._conn.execute(plain, *params)
                    return _PgCursor([], None)
                raise
            lastrowid = None
            if is_insert and rows:
                try:
                    lastrowid = rows[0]["id"]
                except (KeyError, IndexError):
                    lastrowid = None
            return _PgCursor(list(rows), lastrowid)
        else:
            status = await self._conn.execute(pg_sql, *params)
            # asyncpg returns a status like 'UPDATE 3' / 'DELETE 1'
            rc = -1
            try:
                rc = int(str(status).rsplit(' ', 1)[-1])
            except (ValueError, IndexError):
                rc = -1
            return _PgCursor([], None, rowcount=rc)

    async def executescript(self, script: str):
        await self._conn.execute(script)

    async def commit(self):
        pass  # asyncpg autocommits outside explicit transactions

    async def close(self):
        await self._pool.release(self._conn)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.close()


async def _pg_connect() -> PgConnection:
    pool = await _get_pool()
    conn = await pool.acquire()
    return PgConnection(conn, pool)


# ---------------------------------------------------------------------------
# Public API used everywhere
# ---------------------------------------------------------------------------


# Type alias for annotations across the codebase (``db: dbx.Connection``).
Connection = PgConnection


async def _open_connection():
    # Supabase Postgres is the only backend. Schema + seed live in
    # supabase/migrations/.
    return await _pg_connect()


class _Connecting:
    """Awaitable + async-context-manager connection handle.

    Supports both usage styles found in the codebase:
        db = await dbx.connect()        ...  await db.close()
        async with dbx.connect() as db: ...
    """

    def __init__(self):
        self._conn = None

    def __await__(self):
        return _open_connection().__await__()

    async def __aenter__(self):
        self._conn = await _open_connection()
        return self._conn

    async def __aexit__(self, *exc):
        if self._conn is not None:
            await self._conn.close()


def connect():
    """Return a connection handle (awaitable + async context manager)."""
    return _Connecting()
