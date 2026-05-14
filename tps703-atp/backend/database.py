"""SQLite database setup and schema initialization for TPS-703 ATP system."""

import aiosqlite

from config import settings

DB_PATH = settings.DB_PATH


async def get_db_connection() -> aiosqlite.Connection:
    """Return an aiosqlite connection with Row factory enabled."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def init_db() -> None:
    """Create all 11 tables if they do not already exist."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT CHECK(role IN ('admin','engineer','technician','viewer')) NOT NULL,
                full_name TEXT NOT NULL,
                badge_id TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS subsystems (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drawing_no TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                assembly_no TEXT,
                revision TEXT,
                description TEXT,
                rf_band_start_mhz REAL,
                rf_band_stop_mhz REAL,
                nominal_output_dbm REAL,
                nominal_output_watts REAL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS units_under_test (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subsystem_id INTEGER NOT NULL REFERENCES subsystems(id),
                serial_number TEXT NOT NULL,
                part_number TEXT,
                status TEXT DEFAULT 'available',
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(subsystem_id, serial_number)
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS test_procedures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subsystem_id INTEGER NOT NULL REFERENCES subsystems(id),
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                section_ref TEXT,
                sequence_order INTEGER,
                warmup_minutes INTEGER DEFAULT 0,
                default_pulse_width_us REAL,
                is_active INTEGER DEFAULT 1
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS test_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                procedure_id INTEGER NOT NULL REFERENCES test_procedures(id),
                step_number INTEGER NOT NULL,
                name TEXT NOT NULL,
                step_type TEXT NOT NULL,
                instrument TEXT,
                frequency_mhz REAL,
                input_power_dbm REAL,
                pulse_width_us REAL,
                mux_address TEXT,
                mux_sample_time_us REAL,
                bus_address TEXT,
                bus_data TEXT,
                bus_rw TEXT,
                limit_type TEXT,
                limit_min REAL,
                limit_max REAL,
                limit_nominal REAL,
                limit_tolerance REAL,
                unit TEXT,
                instructions TEXT,
                safety_warning TEXT,
                is_optional INTEGER DEFAULT 0,
                is_record_only INTEGER DEFAULT 0
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS calibrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subsystem_id INTEGER NOT NULL REFERENCES subsystems(id),
                performed_by INTEGER NOT NULL REFERENCES users(id),
                cal_type TEXT DEFAULT 'daily',
                ref_cable_sn TEXT,
                performed_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT,
                status TEXT DEFAULT 'valid'
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS calibration_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                calibration_id INTEGER NOT NULL REFERENCES calibrations(id),
                parameter_name TEXT NOT NULL,
                measured_value REAL,
                limit_min REAL,
                limit_max REAL,
                unit TEXT,
                pass_fail TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS test_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                procedure_id INTEGER NOT NULL REFERENCES test_procedures(id),
                uut_id INTEGER NOT NULL REFERENCES units_under_test(id),
                calibration_id INTEGER REFERENCES calibrations(id),
                started_by INTEGER NOT NULL REFERENCES users(id),
                started_at TEXT DEFAULT (datetime('now')),
                completed_at TEXT,
                status TEXT DEFAULT 'pending',
                execution_mode TEXT DEFAULT 'simulator',
                signature_hash TEXT,
                signed_by INTEGER REFERENCES users(id),
                notes TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS test_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_run_id INTEGER NOT NULL REFERENCES test_runs(id),
                step_id INTEGER NOT NULL REFERENCES test_steps(id),
                measured_value REAL,
                secondary_value REAL,
                pass_fail TEXT CHECK(pass_fail IN ('pass','fail','warning','record_only','skipped')),
                measured_at TEXT DEFAULT (datetime('now')),
                raw_data TEXT,
                integrity_hash TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS equipment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                model TEXT,
                manufacturer TEXT,
                serial_number TEXT,
                connection_type TEXT,
                connection_address TEXT,
                cal_due_date TEXT,
                is_active INTEGER DEFAULT 1
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id),
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id INTEGER,
                details TEXT,
                timestamp TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS calibration_equipment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                calibration_id INTEGER NOT NULL REFERENCES calibrations(id),
                equipment_id INTEGER NOT NULL REFERENCES equipment(id),
                UNIQUE(calibration_id, equipment_id)
            )
        """)

        # Migration: add requires_calibration to test_procedures if missing
        try:
            await db.execute(
                "ALTER TABLE test_procedures ADD COLUMN requires_calibration INTEGER DEFAULT 0"
            )
        except Exception:
            pass  # Column already exists

        # Migration: add instrument_role to equipment if missing
        try:
            await db.execute(
                "ALTER TABLE equipment ADD COLUMN instrument_role TEXT"
            )
        except Exception:
            pass  # Column already exists

        await db.commit()
        print(f"Database initialized at {DB_PATH} — 12 tables ready")
