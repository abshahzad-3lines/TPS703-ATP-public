-- ============================================================================
-- 0003_sparam_schema.sql — Phase 11 S-parameter workflows (Postgres)
-- ============================================================================

create table if not exists public.sparam_cal_sets (
    id            bigint generated always as identity primary key,
    name          text not null,
    description   text,
    cal_type      text not null default 'OSLT' check (cal_type in ('OSLT','SOLT','TRL')),
    f_start_hz    double precision,
    f_stop_hz     double precision,
    open_sweep_id  bigint,
    short_sweep_id bigint,
    load_sweep_id  bigint,
    thru_sweep_id  bigint,
    created_by    uuid references public.profiles(id),
    created_at    timestamptz not null default now()
);

create table if not exists public.sparam_sweeps (
    id              bigint generated always as identity primary key,
    test_run_id     bigint,
    uut_id          bigint references public.units_under_test(id),
    subsystem_id    bigint references public.subsystems(id),
    source          text not null check (source in ('uploaded','captured','de_embedded','golden_ref')),
    origin_sweep_id bigint references public.sparam_sweeps(id),
    cal_set_id      bigint references public.sparam_cal_sets(id),
    filename        text,
    n_ports         integer not null,
    n_points        integer not null,
    f_start_hz      double precision not null,
    f_stop_hz       double precision not null,
    z0_ohm          double precision default 50.0,
    format          text default 'MA' check (format in ('MA','DB','RI')),
    touchstone_v2   text not null,
    metadata_json   jsonb,
    uploaded_by     uuid references public.profiles(id),
    created_at      timestamptz not null default now()
);
create index if not exists idx_sparam_sweeps_run on public.sparam_sweeps(test_run_id);
create index if not exists idx_sparam_sweeps_uut on public.sparam_sweeps(uut_id);
create index if not exists idx_sparam_sweeps_subsystem on public.sparam_sweeps(subsystem_id);

-- Now that sparam_sweeps exists, wire the cal-set sweep FKs.
alter table public.sparam_cal_sets
    drop constraint if exists sparam_cal_open_fk,
    add  constraint sparam_cal_open_fk  foreign key (open_sweep_id)  references public.sparam_sweeps(id),
    drop constraint if exists sparam_cal_short_fk,
    add  constraint sparam_cal_short_fk foreign key (short_sweep_id) references public.sparam_sweeps(id),
    drop constraint if exists sparam_cal_load_fk,
    add  constraint sparam_cal_load_fk  foreign key (load_sweep_id)  references public.sparam_sweeps(id),
    drop constraint if exists sparam_cal_thru_fk,
    add  constraint sparam_cal_thru_fk  foreign key (thru_sweep_id)  references public.sparam_sweeps(id);

create table if not exists public.sparam_masks (
    id           bigint generated always as identity primary key,
    name         text not null,
    subsystem_id bigint references public.subsystems(id),
    param        text not null default 's21',
    quantity     text not null default 'mag_db'
        check (quantity in ('mag_db','mag_linear','phase_deg','vswr','return_loss_db')),
    bands_json   jsonb not null,
    created_by   uuid references public.profiles(id),
    created_at   timestamptz not null default now()
);

create table if not exists public.sparam_golden_refs (
    id           bigint generated always as identity primary key,
    name         text not null,
    subsystem_id bigint references public.subsystems(id),
    uut_family   text,
    sweep_id     bigint not null references public.sparam_sweeps(id),
    notes        text,
    created_by   uuid references public.profiles(id),
    created_at   timestamptz not null default now(),
    unique (subsystem_id, uut_family, name)
);

alter table public.sparam_cal_sets    enable row level security;
alter table public.sparam_sweeps       enable row level security;
alter table public.sparam_masks        enable row level security;
alter table public.sparam_golden_refs  enable row level security;
