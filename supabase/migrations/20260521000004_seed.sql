-- ============================================================================
-- 0004_seed.sql — page registry, role→page grants, subsystems, users, equipment
-- ============================================================================
-- Idempotent: safe to re-run. Uses pgcrypto crypt(...,gen_salt('bf')) to make
-- bcrypt hashes that passlib (backend) can verify.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- App page + feature registry (what the roles UI can grant)
-- ----------------------------------------------------------------------------
insert into public.app_pages (path, label, kind, sort_order) values
    ('/dashboard',        'Dashboard',          'page', 10),
    ('/test-setup',       'Test Setup',         'page', 20),
    ('/test-execution',   'Test Execution',     'page', 30),
    ('/results',          'Results',            'page', 40),
    ('/atp-author',       'ATP Author',         'page', 50),
    ('/sparam',           'S-Parameters',       'page', 60),
    ('/equipment',        'Test Equipment',     'page', 70),
    ('/instrument-bench', 'Instrument Bench',   'page', 80),
    ('/admin',            'Audit Trail',        'page', 90),
    ('/roles',            'Roles & Access',     'page', 95),
    ('/profile',          'Profile',            'page', 100),
    ('feature:atp-author',      'Author / edit ATPs',        'feature', 200),
    ('feature:atp-approve',     'Approve / reject ATPs',     'feature', 210),
    ('feature:atp-publish',     'Publish ATPs',              'feature', 220),
    ('feature:sparam-edit',     'Create masks / cal sets / golden refs', 'feature', 230),
    ('feature:manage-equipment','Add / edit / delete equipment', 'feature', 240),
    ('feature:manage-roles',    'Create / edit roles + assign users', 'feature', 250),
    ('feature:ai-assists',      'Use AI assists (Groq)',     'feature', 260)
on conflict (path) do update set label = excluded.label, kind = excluded.kind, sort_order = excluded.sort_order;

-- ----------------------------------------------------------------------------
-- Role → page/feature grants
--   super_admin: bypasses checks in code, but we seed full grants for clarity
--   admin: every app page EXCEPT /roles (cannot manage roles) + all features
--          except manage-roles
--   engineer / technician / viewer: scoped
-- ----------------------------------------------------------------------------

-- Clear existing grants for the system roles so re-running is authoritative.
delete from public.role_pages where role_name in
    ('super_admin','admin','engineer','technician','viewer');

-- super_admin — everything
insert into public.role_pages (role_name, page_path)
    select 'super_admin', path from public.app_pages
on conflict do nothing;

-- admin — all pages except /roles, all features except manage-roles
insert into public.role_pages (role_name, page_path)
    select 'admin', path from public.app_pages
    where path <> '/roles' and path <> 'feature:manage-roles'
on conflict do nothing;

-- engineer
insert into public.role_pages (role_name, page_path) values
    ('engineer','/dashboard'), ('engineer','/test-setup'), ('engineer','/test-execution'),
    ('engineer','/results'), ('engineer','/atp-author'), ('engineer','/sparam'),
    ('engineer','/equipment'), ('engineer','/instrument-bench'), ('engineer','/profile'),
    ('engineer','feature:atp-author'), ('engineer','feature:atp-approve'),
    ('engineer','feature:atp-publish'), ('engineer','feature:sparam-edit'),
    ('engineer','feature:manage-equipment'), ('engineer','feature:ai-assists')
on conflict do nothing;

-- technician
insert into public.role_pages (role_name, page_path) values
    ('technician','/dashboard'), ('technician','/test-setup'), ('technician','/test-execution'),
    ('technician','/results'), ('technician','/sparam'), ('technician','/equipment'),
    ('technician','/instrument-bench'), ('technician','/profile')
on conflict do nothing;

-- viewer
insert into public.role_pages (role_name, page_path) values
    ('viewer','/dashboard'), ('viewer','/results'), ('viewer','/profile')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Seed users (bcrypt via pgcrypto). Demo creds — change before production.
-- ----------------------------------------------------------------------------
insert into public.profiles (username, full_name, role, password_hash, email) values
    ('superadmin', 'Super Administrator', 'super_admin', crypt('super1234', gen_salt('bf')), 'superadmin@tps703.local'),
    ('admin',      'System Administrator', 'admin',       crypt('admin123',  gen_salt('bf')), 'admin@tps703.local'),
    ('eng',        'Lead Engineer',        'engineer',    crypt('eng1234',   gen_salt('bf')), 'eng@tps703.local'),
    ('peer',       'Peer Engineer',        'engineer',    crypt('peer1234',  gen_salt('bf')), 'peer@tps703.local'),
    ('tech',       'Bench Technician',     'technician',  crypt('tech1234',  gen_salt('bf')), 'tech@tps703.local'),
    ('viewer',     'Read-only Viewer',     'viewer',      crypt('view1234',  gen_salt('bf')), 'viewer@tps703.local')
on conflict (username) do nothing;

-- ----------------------------------------------------------------------------
-- Subsystems (4 radar subsystems)
-- ----------------------------------------------------------------------------
insert into public.subsystems
    (drawing_no, name, assembly_no, revision, description, rf_band_start_mhz, rf_band_stop_mhz, nominal_output_dbm, nominal_output_watts)
values
    ('110K245','Power Module Assembly','100K517','E','Amplifies 42.5 dBm to 58.6 dBm minimum (724W)',2800,3100,58.60,724),
    ('110K244','Preamplifier Panel Assembly','100K520','M','Amplifies 16.0 dBm to 61.85-62.85 dBm (1531-1928W)',2800,3100,61.85,1531),
    ('110K243','RF Output Panel Assembly','100K515','F','Amplifies 49.50 dBm to 64.0 dBm minimum (2512W)',2800,3100,64.00,2512),
    ('IF_RECVR','Digital IF Receiver Assembly','810R349G01',null,'Receives 25-35 MHz IF, digitizes to 16-bit IQ',25,35,null,null)
on conflict (drawing_no) do nothing;

-- ----------------------------------------------------------------------------
-- Placeholder equipment (one per instrument role) — clearly marked demo rows.
-- Real installs overwrite via discovery/reconcile.
-- ----------------------------------------------------------------------------
insert into public.equipment (name, manufacturer, model, instrument_role, connection_type, is_active) values
    ('Demo multimeter (replace before lab use)',        'Keysight','34465A',  'multimeter',        'simulator', true),
    ('Demo power meter (replace before lab use)',        'Keysight','N1912A',  'power_meter',       'simulator', true),
    ('Demo signal generator (replace before lab use)',   'Keysight','N5181B',  'signal_generator',  'simulator', true),
    ('Demo oscilloscope (replace before lab use)',       'Keysight','DSOS104A','oscilloscope',      'simulator', true),
    ('Demo spectrum analyzer (replace before lab use)',  'Keysight','N9020B',  'spectrum_analyzer', 'simulator', true),
    ('Demo network analyzer (replace before lab use)',   'Keysight','N5247B',  'network_analyzer',  'simulator', true),
    ('Demo phase meter (replace before lab use)',        'Pendulum','CNT-91R', 'phase_meter',       'simulator', true),
    ('Demo FFT display (replace before lab use)',        'Internal','FPGA-FFT','fft_display',       'simulator', true),
    ('Demo common bus (replace before lab use)',         'Internal','1553',    'common_bus',        'simulator', true)
on conflict do nothing;
