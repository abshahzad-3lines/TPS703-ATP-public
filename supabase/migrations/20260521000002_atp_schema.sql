-- ============================================================================
-- 0002_atp_schema.sql — Core domain + Phase 10 ATP authoring (Postgres)
-- ============================================================================
-- Postgres port of the v1 domain tables + the Phase 10 authoring layer.
-- SQLite-isms translated:
--   INTEGER PRIMARY KEY AUTOINCREMENT  -> bigint generated always as identity
--   datetime('now')                    -> now()
--   TEXT CHECK(...)                    -> text + check constraint
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Subsystems (the 4 radar subsystems under test)
-- ----------------------------------------------------------------------------
create table if not exists public.subsystems (
    id                  bigint generated always as identity primary key,
    drawing_no          text unique not null,
    name                text not null,
    assembly_no         text,
    revision            text,
    description         text,
    rf_band_start_mhz   double precision,
    rf_band_stop_mhz    double precision,
    nominal_output_dbm  double precision,
    nominal_output_watts double precision
);

-- ----------------------------------------------------------------------------
-- Equipment inventory (instruments)
-- ----------------------------------------------------------------------------
create table if not exists public.equipment (
    id                 bigint generated always as identity primary key,
    name               text not null,
    model              text,
    manufacturer       text,
    serial_number      text,
    connection_type    text,
    connection_address text,
    cal_due_date       text,
    instrument_role    text,
    is_active          boolean not null default true
);
create index if not exists idx_equipment_role on public.equipment(instrument_role) where is_active;

-- ----------------------------------------------------------------------------
-- Units under test
-- ----------------------------------------------------------------------------
create table if not exists public.units_under_test (
    id            bigint generated always as identity primary key,
    subsystem_id  bigint not null references public.subsystems(id),
    serial_number text not null,
    part_number   text,
    status        text not null default 'available',
    created_at    timestamptz not null default now(),
    unique (subsystem_id, serial_number)
);

-- ----------------------------------------------------------------------------
-- ATP definitions (Phase 10 — revisioned, state-machine governed)
-- ----------------------------------------------------------------------------
create table if not exists public.atp_definitions (
    id                          bigint generated always as identity primary key,
    subsystem_id                bigint not null references public.subsystems(id),
    code                        text not null,
    revision                    text not null default 'A',
    name                        text not null,
    section_ref                 text,
    sequence_order              integer,
    warmup_minutes              integer default 0,
    default_pulse_width_us      double precision,
    requires_calibration        boolean not null default false,
    state                       text not null default 'draft'
        check (state in ('draft','in_review','approved','published','superseded')),
    source                      text not null default 'authored'
        check (source in ('migrated','authored','imported_docx','imported_pdf','ai_extracted')),
    parent_definition_id        bigint references public.atp_definitions(id),
    created_by                  uuid references public.profiles(id),
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),
    published_at                timestamptz,
    published_by                uuid references public.profiles(id),
    superseded_at               timestamptz,
    superseded_by_definition_id bigint references public.atp_definitions(id),
    notes                       text,
    unique (code, revision)
);
create index if not exists idx_atp_def_code on public.atp_definitions(code);
create index if not exists idx_atp_def_state on public.atp_definitions(state);
create index if not exists idx_atp_def_subsystem on public.atp_definitions(subsystem_id);

-- ----------------------------------------------------------------------------
-- ATP steps
-- ----------------------------------------------------------------------------
create table if not exists public.atp_steps (
    id                 bigint generated always as identity primary key,
    definition_id      bigint not null references public.atp_definitions(id) on delete cascade,
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
    is_record_only     boolean not null default false,
    unique (definition_id, step_number)
);
create index if not exists idx_atp_steps_def on public.atp_steps(definition_id, step_number);

-- ----------------------------------------------------------------------------
-- State transitions (audit of every state change)
-- ----------------------------------------------------------------------------
create table if not exists public.atp_state_transitions (
    id             bigint generated always as identity primary key,
    definition_id  bigint not null references public.atp_definitions(id) on delete cascade,
    from_state     text,
    to_state       text not null,
    user_id        uuid references public.profiles(id),
    comment        text,
    transitioned_at timestamptz not null default now()
);
create index if not exists idx_atp_transitions_def on public.atp_state_transitions(definition_id);

-- ----------------------------------------------------------------------------
-- Peer-review approvals (review_round allows re-vote after fix)
-- ----------------------------------------------------------------------------
create table if not exists public.atp_approvals (
    id            bigint generated always as identity primary key,
    definition_id bigint not null references public.atp_definitions(id) on delete cascade,
    approver_id   uuid not null references public.profiles(id),
    review_round  integer not null default 1,
    decision      text not null check (decision in ('approve','reject')),
    comment       text,
    decided_at    timestamptz not null default now(),
    unique (definition_id, approver_id, review_round)
);
create index if not exists idx_atp_approvals_def on public.atp_approvals(definition_id);

-- ----------------------------------------------------------------------------
-- Document imports (.docx / .pdf)
-- ----------------------------------------------------------------------------
create table if not exists public.atp_imports (
    id                bigint generated always as identity primary key,
    definition_id     bigint references public.atp_definitions(id) on delete set null,
    filename          text not null,
    mime_type         text,
    file_size         bigint,
    source_type       text not null check (source_type in ('docx','pdf')),
    uploaded_by       uuid references public.profiles(id),
    uploaded_at       timestamptz not null default now(),
    extracted_text    text,
    extraction_status text not null default 'uploaded'
        check (extraction_status in ('uploaded','extracted','linked','failed')),
    extraction_error  text
);

-- ----------------------------------------------------------------------------
-- Golden-unit simulations
-- ----------------------------------------------------------------------------
create table if not exists public.atp_simulations (
    id            bigint generated always as identity primary key,
    definition_id bigint not null references public.atp_definitions(id) on delete cascade,
    pass_count    integer not null default 0,
    fail_count    integer not null default 0,
    skipped_count integer not null default 0,
    summary_json  jsonb,
    simulated_at  timestamptz not null default now(),
    simulated_by  uuid references public.profiles(id)
);

-- ----------------------------------------------------------------------------
-- Append-only audit log
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
    id          bigint generated always as identity primary key,
    user_id     uuid references public.profiles(id),
    action      text not null,
    entity_type text,
    entity_id   bigint,
    details     text,
    "timestamp" timestamptz not null default now()
);
create index if not exists idx_audit_ts on public.audit_log("timestamp");

-- updated_at trigger on atp_definitions
drop trigger if exists trg_atp_def_touch on public.atp_definitions;
create trigger trg_atp_def_touch
    before update on public.atp_definitions
    for each row execute function public.touch_updated_at();

-- RLS: backend-only (service role bypasses). Lock everything else out.
alter table public.subsystems            enable row level security;
alter table public.equipment             enable row level security;
alter table public.units_under_test      enable row level security;
alter table public.atp_definitions       enable row level security;
alter table public.atp_steps             enable row level security;
alter table public.atp_state_transitions enable row level security;
alter table public.atp_approvals         enable row level security;
alter table public.atp_imports           enable row level security;
alter table public.atp_simulations       enable row level security;
alter table public.audit_log             enable row level security;
