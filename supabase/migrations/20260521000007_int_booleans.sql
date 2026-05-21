-- ============================================================================
-- 0007_int_booleans.sql — store app-written booleans as smallint (0/1)
-- ============================================================================
-- The Python data layer was written for SQLite (booleans are 0/1 ints), so
-- these domain columns become smallint to keep the dbx Postgres shim
-- transparent. Pattern per column: drop default -> change type -> restore.
-- ============================================================================

drop index if exists public.idx_equipment_role;
alter table public.equipment alter column is_active drop default;
alter table public.equipment alter column is_active type smallint using (is_active::int);
alter table public.equipment alter column is_active set default 1;

alter table public.atp_definitions alter column requires_calibration drop default;
alter table public.atp_definitions alter column requires_calibration type smallint using (requires_calibration::int);
alter table public.atp_definitions alter column requires_calibration set default 0;

alter table public.atp_steps alter column is_optional drop default;
alter table public.atp_steps alter column is_optional type smallint using (is_optional::int);
alter table public.atp_steps alter column is_optional set default 0;

alter table public.atp_steps alter column is_record_only drop default;
alter table public.atp_steps alter column is_record_only type smallint using (is_record_only::int);
alter table public.atp_steps alter column is_record_only set default 0;

alter table public.test_procedures alter column is_active drop default;
alter table public.test_procedures alter column is_active type smallint using (is_active::int);
alter table public.test_procedures alter column is_active set default 1;

alter table public.test_procedures alter column requires_calibration drop default;
alter table public.test_procedures alter column requires_calibration type smallint using (requires_calibration::int);
alter table public.test_procedures alter column requires_calibration set default 0;

alter table public.test_steps alter column is_optional drop default;
alter table public.test_steps alter column is_optional type smallint using (is_optional::int);
alter table public.test_steps alter column is_optional set default 0;

alter table public.test_steps alter column is_record_only drop default;
alter table public.test_steps alter column is_record_only type smallint using (is_record_only::int);
alter table public.test_steps alter column is_record_only set default 0;

-- recreate the partial index with an integer predicate
create index if not exists idx_equipment_role on public.equipment(instrument_role) where is_active = 1;
