-- ============================================================================
-- 0006_v1_legacy_tables.sql — v1 execution tables the app still reads/writes
-- ============================================================================
-- The dashboard, test-execution, results, calibration and analytics features
-- run on these original tables. Phase 10 removed only the auto-migration into
-- atp_definitions; the v1 tables themselves remain the system of record for
-- live test runs.
-- ============================================================================

create table if not exists public.test_procedures (
    id                     bigint generated always as identity primary key,
    subsystem_id           bigint not null references public.subsystems(id),
    code                   text unique not null,
    name                   text not null,
    section_ref            text,
    sequence_order         integer,
    warmup_minutes         integer default 0,
    default_pulse_width_us double precision,
    requires_calibration   boolean not null default false,
    is_active              boolean not null default true
);

create table if not exists public.test_steps (
    id                 bigint generated always as identity primary key,
    procedure_id       bigint not null references public.test_procedures(id),
    step_number        integer not null,
    name               text not null,
    step_type          text not null,
    instrument         text,
    frequency_mhz      double precision,
    input_power_dbm    double precision,
    pulse_width_us     double precision,
    mux_address        text,
    mux_sample_time_us double precision,
    bus_address        text,
    bus_data           text,
    bus_rw             text,
    limit_type         text,
    limit_min          double precision,
    limit_max          double precision,
    limit_nominal      double precision,
    limit_tolerance    double precision,
    unit               text,
    instructions       text,
    safety_warning     text,
    is_optional        boolean not null default false,
    is_record_only     boolean not null default false
);

create table if not exists public.calibrations (
    id           bigint generated always as identity primary key,
    subsystem_id bigint not null references public.subsystems(id),
    performed_by uuid references public.profiles(id),
    cal_type     text default 'daily',
    ref_cable_sn text,
    performed_at timestamptz not null default now(),
    expires_at   timestamptz,
    status       text default 'valid'
);

create table if not exists public.calibration_results (
    id             bigint generated always as identity primary key,
    calibration_id bigint not null references public.calibrations(id),
    parameter_name text not null,
    measured_value double precision,
    limit_min      double precision,
    limit_max      double precision,
    unit           text,
    pass_fail      text
);

create table if not exists public.calibration_equipment (
    id             bigint generated always as identity primary key,
    calibration_id bigint not null references public.calibrations(id),
    equipment_id   bigint not null references public.equipment(id),
    unique (calibration_id, equipment_id)
);

create table if not exists public.test_runs (
    id              bigint generated always as identity primary key,
    procedure_id    bigint not null references public.test_procedures(id),
    uut_id          bigint not null references public.units_under_test(id),
    calibration_id  bigint references public.calibrations(id),
    started_by      uuid references public.profiles(id),
    started_at      timestamptz not null default now(),
    completed_at    timestamptz,
    status          text default 'pending',
    execution_mode  text default 'simulator',
    signature_hash  text,
    signed_by       uuid references public.profiles(id),
    notes           text
);

create table if not exists public.test_results (
    id             bigint generated always as identity primary key,
    test_run_id    bigint not null references public.test_runs(id),
    step_id        bigint not null references public.test_steps(id),
    measured_value double precision,
    secondary_value double precision,
    pass_fail      text check (pass_fail in ('pass','fail','warning','record_only','skipped')),
    measured_at    timestamptz not null default now(),
    raw_data       text,
    integrity_hash text
);

create index if not exists idx_test_steps_proc on public.test_steps(procedure_id);
create index if not exists idx_test_runs_uut on public.test_runs(uut_id);
create index if not exists idx_test_results_run on public.test_results(test_run_id);

alter table public.test_procedures      enable row level security;
alter table public.test_steps           enable row level security;
alter table public.calibrations         enable row level security;
alter table public.calibration_results  enable row level security;
alter table public.calibration_equipment enable row level security;
alter table public.test_runs            enable row level security;
alter table public.test_results         enable row level security;
