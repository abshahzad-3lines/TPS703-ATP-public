-- ============================================================================
-- 0001_rbac_core.sql — Role-Based Access Control foundation
-- ============================================================================
-- Database-driven RBAC modelled on the ai-command-center pattern:
--   profiles    — one row per user (links to auth identity), carries `role`
--   roles       — the catalogue of roles (incl. custom ones)
--   role_pages  — maps a role to the pages + feature flags it may access
--
-- Privilege model:
--   super_admin — can manage roles + role_pages + users. Bypasses all checks.
--   admin       — sees every application page, but cannot manage roles.
--   <custom>    — sees exactly what role_pages grants it.
--
-- This file is database-agnostic-ish standard SQL where possible; Postgres
-- specifics (identity columns, citext, RLS) are isolated so a future port to
-- another engine is a mechanical edit, not a redesign.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- roles — catalogue of every role in the system
-- ----------------------------------------------------------------------------
create table if not exists public.roles (
    name          text primary key,
    label         text not null,
    description   text,
    -- system roles cannot be deleted or renamed (super_admin, admin, ...)
    is_system     boolean not null default false,
    -- rank is a coarse ordering for UI sorting + "at least this privileged"
    -- style checks. Higher = more privileged. Not used for access decisions
    -- (those are page-level), just for display + sensible defaults.
    rank          integer not null default 0,
    created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- profiles — one per user
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
    id            uuid primary key default gen_random_uuid(),
    username      text unique not null,
    email         text,
    full_name     text not null,
    badge_id      text,
    role          text not null references public.roles(name) on update cascade,
    password_hash text,                 -- bcrypt; null when auth is delegated
    is_active     boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists idx_profiles_role on public.profiles(role);

-- ----------------------------------------------------------------------------
-- role_pages — what each role can reach
-- ----------------------------------------------------------------------------
-- A page_path is either an app route ('/atp-author') OR a feature flag
-- ('feature:edit-atp'). Same table, same lookup, mirrors the reference app.
-- ----------------------------------------------------------------------------
create table if not exists public.role_pages (
    role_name   text not null references public.roles(name) on delete cascade on update cascade,
    page_path   text not null,
    created_at  timestamptz not null default now(),
    primary key (role_name, page_path)
);
create index if not exists idx_role_pages_role on public.role_pages(role_name);

-- ----------------------------------------------------------------------------
-- app_pages — the registry of every page/feature the UI exposes.
-- The roles-management UI reads this to know what's grantable.
-- ----------------------------------------------------------------------------
create table if not exists public.app_pages (
    path        text primary key,
    label       text not null,
    kind        text not null default 'page' check (kind in ('page','feature')),
    min_note    text,            -- optional human note
    sort_order  integer not null default 0
);

-- ----------------------------------------------------------------------------
-- updated_at trigger for profiles
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
    before update on public.profiles
    for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Seed the system roles
-- ----------------------------------------------------------------------------
insert into public.roles (name, label, description, is_system, rank) values
    ('super_admin', 'Super Admin', 'Full control incl. role + user management. Bypasses every access check.', true, 100),
    ('admin',       'Administrator', 'Sees every application page. Cannot manage roles.', true, 80),
    ('engineer',    'Engineer', 'Authors/approves ATPs, signs off runs, S-parameter analysis.', true, 60),
    ('technician',  'Technician', 'Runs tests, uploads sweeps, operates the bench.', true, 40),
    ('viewer',      'Viewer', 'Read-only access to results + dashboards.', true, 20)
on conflict (name) do update
    set label = excluded.label,
        description = excluded.description,
        is_system = excluded.is_system,
        rank = excluded.rank;

-- ----------------------------------------------------------------------------
-- RLS — service role (backend) bypasses RLS automatically. We enable RLS so
-- the anon/auth keys can't read these tables directly from the browser; all
-- access goes through the FastAPI backend using the service role key.
-- ----------------------------------------------------------------------------
alter table public.roles      enable row level security;
alter table public.profiles   enable row level security;
alter table public.role_pages enable row level security;
alter table public.app_pages  enable row level security;

-- Authenticated users may read the page registry + role catalogue (harmless
-- metadata the UI needs). Everything else stays backend-only.
drop policy if exists "read app_pages" on public.app_pages;
create policy "read app_pages" on public.app_pages for select using (true);

drop policy if exists "read roles" on public.roles;
create policy "read roles" on public.roles for select using (true);

drop policy if exists "read role_pages" on public.role_pages;
create policy "read role_pages" on public.role_pages for select using (true);
