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

        # ------------------------------------------------------------------
        # Phase 10 — ATP authoring schema (v2)
        # ------------------------------------------------------------------
        # v1 stored procedures + steps in `test_procedures` / `test_steps`.
        # v2 introduces a revisioned, state-machine-governed authoring layer:
        # `atp_definitions` + `atp_steps`. v1 tables remain intact because
        # `test_runs` / `test_results` still FK into them (existing runs
        # must keep resolving). New runs created after Phase 10 cutover
        # source their step list from `atp_steps` via the linked v1 row.
        # ------------------------------------------------------------------

        await db.execute("""
            CREATE TABLE IF NOT EXISTS atp_definitions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subsystem_id INTEGER NOT NULL REFERENCES subsystems(id),
                legacy_procedure_id INTEGER REFERENCES test_procedures(id),
                code TEXT NOT NULL,
                revision TEXT NOT NULL DEFAULT 'A',
                name TEXT NOT NULL,
                section_ref TEXT,
                sequence_order INTEGER,
                warmup_minutes INTEGER DEFAULT 0,
                default_pulse_width_us REAL,
                requires_calibration INTEGER DEFAULT 0,
                state TEXT NOT NULL DEFAULT 'draft'
                    CHECK(state IN ('draft','in_review','approved','published','superseded')),
                source TEXT NOT NULL DEFAULT 'authored'
                    CHECK(source IN ('migrated','authored','imported_docx','imported_pdf','ai_extracted')),
                parent_definition_id INTEGER REFERENCES atp_definitions(id),
                created_by INTEGER REFERENCES users(id),
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                published_at TEXT,
                published_by INTEGER REFERENCES users(id),
                superseded_at TEXT,
                superseded_by_definition_id INTEGER REFERENCES atp_definitions(id),
                notes TEXT,
                UNIQUE(code, revision)
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS atp_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                definition_id INTEGER NOT NULL REFERENCES atp_definitions(id) ON DELETE CASCADE,
                legacy_step_id INTEGER REFERENCES test_steps(id),
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
                is_record_only INTEGER DEFAULT 0,
                UNIQUE(definition_id, step_number)
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS atp_state_transitions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                definition_id INTEGER NOT NULL REFERENCES atp_definitions(id) ON DELETE CASCADE,
                from_state TEXT,
                to_state TEXT NOT NULL,
                user_id INTEGER REFERENCES users(id),
                comment TEXT,
                transitioned_at TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS atp_approvals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                definition_id INTEGER NOT NULL REFERENCES atp_definitions(id) ON DELETE CASCADE,
                approver_id INTEGER NOT NULL REFERENCES users(id),
                decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
                comment TEXT,
                decided_at TEXT DEFAULT (datetime('now')),
                UNIQUE(definition_id, approver_id)
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS atp_imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                definition_id INTEGER REFERENCES atp_definitions(id) ON DELETE SET NULL,
                filename TEXT NOT NULL,
                mime_type TEXT,
                file_size INTEGER,
                source_type TEXT NOT NULL CHECK(source_type IN ('docx','pdf')),
                uploaded_by INTEGER REFERENCES users(id),
                uploaded_at TEXT DEFAULT (datetime('now')),
                extracted_text TEXT,
                extraction_status TEXT NOT NULL DEFAULT 'uploaded'
                    CHECK(extraction_status IN ('uploaded','extracted','linked','failed')),
                extraction_error TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS atp_simulations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                definition_id INTEGER NOT NULL REFERENCES atp_definitions(id) ON DELETE CASCADE,
                golden_run_id INTEGER REFERENCES test_runs(id),
                pass_count INTEGER NOT NULL DEFAULT 0,
                fail_count INTEGER NOT NULL DEFAULT 0,
                skipped_count INTEGER NOT NULL DEFAULT 0,
                summary_json TEXT,
                simulated_at TEXT DEFAULT (datetime('now')),
                simulated_by INTEGER REFERENCES users(id)
            )
        """)

        # Helpful indices
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_atp_def_code ON atp_definitions(code)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_atp_def_state ON atp_definitions(state)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_atp_def_subsystem ON atp_definitions(subsystem_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_atp_steps_def ON atp_steps(definition_id, step_number)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_atp_transitions_def ON atp_state_transitions(definition_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_atp_approvals_def ON atp_approvals(definition_id)"
        )

        # ------------------------------------------------------------------
        # Idempotent v1 → v2 backfill
        # ------------------------------------------------------------------
        # Migrate every test_procedure that does not yet have a matching
        # atp_definitions row (matched by legacy_procedure_id). Each becomes
        # rev 'A', state 'published' (the existing v1 data is the authority
        # of record), source 'migrated', linked back via legacy_procedure_id
        # so test_runs can keep resolving step lists either way.
        # ------------------------------------------------------------------
        cursor = await db.execute(
            """
            SELECT tp.id, tp.subsystem_id, tp.code, tp.name, tp.section_ref,
                   tp.sequence_order, tp.warmup_minutes, tp.default_pulse_width_us,
                   tp.requires_calibration
            FROM test_procedures tp
            LEFT JOIN atp_definitions ad ON ad.legacy_procedure_id = tp.id
            WHERE ad.id IS NULL
            """
        )
        legacy_procs = await cursor.fetchall()

        for proc in legacy_procs:
            insert_cursor = await db.execute(
                """
                INSERT INTO atp_definitions (
                    subsystem_id, legacy_procedure_id, code, revision, name,
                    section_ref, sequence_order, warmup_minutes,
                    default_pulse_width_us, requires_calibration,
                    state, source, created_by, published_at, published_by, notes
                ) VALUES (?, ?, ?, 'A', ?, ?, ?, ?, ?, ?, 'published', 'migrated',
                          NULL, datetime('now'), NULL, ?)
                """,
                (
                    proc[1],  # subsystem_id
                    proc[0],  # legacy_procedure_id
                    proc[2],  # code
                    proc[3],  # name
                    proc[4],  # section_ref
                    proc[5],  # sequence_order
                    proc[6],  # warmup_minutes
                    proc[7],  # default_pulse_width_us
                    proc[8],  # requires_calibration
                    f"Migrated from v1 test_procedures.id={proc[0]}",
                ),
            )
            new_def_id = insert_cursor.lastrowid

            # Record the migration as a synthetic state transition so the
            # provenance is captured in atp_state_transitions, not just
            # the notes field.
            await db.execute(
                """
                INSERT INTO atp_state_transitions
                    (definition_id, from_state, to_state, user_id, comment)
                VALUES (?, NULL, 'published', NULL, 'v1 schema migration')
                """,
                (new_def_id,),
            )

            # Copy steps
            step_cursor = await db.execute(
                """
                SELECT id, step_number, name, step_type, instrument,
                       frequency_mhz, input_power_dbm, pulse_width_us,
                       mux_address, mux_sample_time_us, bus_address, bus_data,
                       bus_rw, limit_type, limit_min, limit_max, limit_nominal,
                       limit_tolerance, unit, instructions, safety_warning,
                       is_optional, is_record_only
                FROM test_steps WHERE procedure_id = ?
                ORDER BY step_number
                """,
                (proc[0],),
            )
            steps = await step_cursor.fetchall()
            for s in steps:
                await db.execute(
                    """
                    INSERT INTO atp_steps (
                        definition_id, legacy_step_id, step_number, name,
                        step_type, instrument, frequency_mhz, input_power_dbm,
                        pulse_width_us, mux_address, mux_sample_time_us,
                        bus_address, bus_data, bus_rw, limit_type, limit_min,
                        limit_max, limit_nominal, limit_tolerance, unit,
                        instructions, safety_warning, is_optional, is_record_only
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (new_def_id, *tuple(s)),
                )

        await db.commit()
        if legacy_procs:
            print(
                f"Phase-10 migration: {len(legacy_procs)} v1 procedure(s) "
                f"copied into atp_definitions as revision 'A' / 'published'"
            )
        print(f"Database initialized at {DB_PATH} — 18 tables ready")
