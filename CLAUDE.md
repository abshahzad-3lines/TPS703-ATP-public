# TPS-703 ATP Automation System

## Project Overview
Web-based Acceptance Test Procedure (ATP) automation system for the TPS-703 radar transmitter subsystems manufactured by Northrop Grumman (CAGE Code 97942). The system manages acceptance testing for 4 radar subsystems operating in S-band (2.8-3.1 GHz).

## Technology Stack
- **Backend**: Python 3.11+ / FastAPI
- **Frontend**: React 19 + TypeScript 5+ + Vite 5+
- **UI Library**: shadcn/ui (Radix UI + Tailwind CSS)
- **Instrument Visualization**: Recharts (structured data) + HTML5 Canvas (waveforms)
- **State Management**: Zustand
- **Database**: Supabase Postgres via asyncpg (through the `dbx` connection layer); schema in `supabase/migrations/`. SQLite/aiosqlite fully removed.
- **Auth**: JWT (python-jose) + passlib[bcrypt]
- **Real-time**: WebSocket (FastAPI native)
- **Equipment I/O**: PyVISA (GPIB/VISA) + SCPI over TCP + zeroconf (mDNS LXI/SCPI-RAW/VXI-11 LAN discovery)
- **PDF Reports**: reportlab
- **Deployment**: Local web server (uvicorn)

## Subsystems Under Test
1. **110K245** - Power Module Assembly (100K517) - 724W output
2. **110K244** - Preamplifier Panel Assembly (100K520) - 1531W output
3. **110K243** - RF Output Panel Assembly (100K515) - 2512W output
4. **IF Receiver** - Digital IF Receiver Assembly - IQ data processing

## Project Structure
```
tps703-atp/
  backend/          - FastAPI server, database, test engine, equipment drivers
  frontend/         - React 19 + shadcn/ui application
```

## Key Commands
```bash
# Backend
cd tps703-atp/backend
python -m venv venv
source venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd tps703-atp/frontend
npm install
npx shadcn@latest init
npm run dev
```

## React 19 Conventions
- **No forwardRef**: Use `ref` as a regular prop on function components
- **No Context.Provider**: Use `<ThemeContext value={...}>` directly
- **Form Actions**: Use `action` prop on `<form>` with `useActionState` for form submissions
- **useActionState**: Replaces manual isPending/error state for async form handlers
- **useFormStatus**: Read parent `<form>` pending state without prop drilling
- **useOptimistic**: Optimistic UI updates for test parameter changes
- **use()**: Read promises and context conditionally (e.g., `use(ThemeContext)` after early returns)
- **Ref cleanup functions**: Return cleanup from ref callbacks instead of checking for `null`
- **Document metadata**: Render `<title>`, `<meta>` directly in components (auto-hoisted to `<head>`)
- **Error handling**: Use `onCaughtError`, `onUncaughtError`, `onRecoverableError` on `createRoot`

## General Conventions
- All test results are immutable once recorded
- HMAC-SHA256 signatures on completed test runs
- Audit logging on all write operations
- DB-driven RBAC: `profiles` → `roles` → `role_pages` (page/feature grants) + `app_pages` registry. `super_admin` bypasses all; `admin` sees every page except Roles & Access; custom roles are scoped by their `role_pages` grants. Managed live from the Roles & Access page.
- Virtual instrument panels use light gray instrument bezel aesthetic
- Status colors: Pass=emerald-500, Fail=red-500, Warning=amber-500, Running=blue-500, Pending=slate-500
- **No fake instruments / no synthesised readings** — panels show `--` when no real reading is available

---

## Development Workflow

### Feature-by-Feature Build Process
Built **feature by feature** using isolated git worktrees. Each feature on its own branch, tested independently, then merged into `main`.

**Workflow:**
1. Create feature branch from `main` using `isolation: "worktree"` (the worktree is the sandbox)
2. Implement in the isolated worktree
3. Test independently in the sandbox
4. End-to-end verification via Chrome DevTools MCP if UI (skip for backend-only)
5. Merge `main` into feature branch — resolve conflicts here safely
6. Test again with merged main
7. Merge feature branch into `main` — guaranteed clean
8. Update this CLAUDE.md

**Branch naming**: `feature/<phase>-<short-description>`

**Agent spawning rule**: Each feature MUST be implemented by its own dedicated Agent with `isolation: "worktree"`. Spawn one Agent per feature in parallel. Never combine multiple features into a single Agent.

### Implementation Phases & Features

#### Phase 1: Project Scaffolding + Database + Auth
- [x] `feature/p1-backend-scaffolding` — FastAPI structure, config, main.py with CORS and lifespan
- [x] `feature/p1-database-schema` — SQLite schema (11 tables), database.py connection setup
- [x] `feature/p1-seed-data` — Seed 4 subsystems, procedures, test steps from ATP documents
- [x] `feature/p1-frontend-scaffolding` — Vite + React 19 + TypeScript + Tailwind
- [x] `feature/p1-shadcn-setup` — shadcn/ui (button, card, input, table, badge, dialog, select, progress, tabs, alert, dropdown-menu, separator, tooltip)
- [x] `feature/p1-createroot-config` — main.tsx createRoot with React 19 error handlers
- [x] `feature/p1-contexts` — AuthContext.ts, TestContext.ts, ThemeContext.ts (used as `<Context value={}>`)
- [x] `feature/p1-jwt-auth` — JWT auth backend (login, refresh, role middleware, password hashing)
- [x] `feature/p1-login-page` — Login page with `<form action={submitAction}>` + useActionState + SubmitButton (useFormStatus)
- [x] `feature/p1-appshell` — AppShell layout (sidebar, header, role badge)
- [x] `feature/p1-protected-route` — ProtectedRoute with role-based access control

#### Phase 2: Seed Data + Dashboard + Test Setup
- [x] `feature/p2-subsystem-api` — GET /api/subsystems, GET /api/subsystems/{id}/procedures
- [x] `feature/p2-uut-api` — POST /api/uuts, GET /api/uuts, GET /api/uuts/{id}/history
- [x] `feature/p2-calibration-api` — POST /api/calibrations, GET /api/calibrations/valid/{id} + 24h expiry
- [x] `feature/p2-dashboard-page` — Dashboard with ModuleStatusCards for 4 subsystems
- [x] `feature/p2-recent-tests-table` — RecentTestsTable via use(promise) + Suspense
- [x] `feature/p2-calibration-status` — CalibrationStatus panel with countdown timer
- [x] `feature/p2-test-setup-page` — TestSetup with `<form action={...}>` + useActionState
- [x] `feature/p2-uut-registration-ui` — UUT registration with useOptimistic

#### Phase 3: Test Execution Engine + Core UI
- [x] `feature/p3-test-engine` — TestEngine state machine (pending→running→paused/passed/failed/aborted)
- [x] `feature/p3-step-execution` — Step execution (read params, call driver, compare limits, immutable result)
- [x] `feature/p3-simulator-driver` — SimulatorDriver with controlled Gaussian variance per step type
- [x] `feature/p3-websocket` — WebSocket /ws/test/{id} for live data streaming
- [x] `feature/p3-execution-page-layout` — TestExecutionPage 3-col layout with useOptimistic + useDeferredValue
- [x] `feature/p3-step-panel` — StepPanel (current step instructions, safety warnings, parameter inputs)
- [x] `feature/p3-progress-bar` — TestProgressBar (shadcn Progress + vertical step list + status badges)
- [x] `feature/p3-control-bar` — TestControlBar (Start/Pause/Resume/Abort)
- [x] `feature/p3-parameter-input` — ParameterInput (validated numeric input with limit display)
- [x] `feature/p3-status-badges` — 5-state status badge system (pass/fail/warning/running/pending)
- [x] `feature/p3-datasheet-preview` — DataSheetPreview (live-updating, matches original ATP format)

#### Phase 4: Virtual Instrument Panels
- [x] `feature/p4-instrument-rack` — InstrumentRack CSS Grid container
- [x] `feature/p4-power-meter` — PowerMeterPanel: amber 7-segment, Recharts horizontal bar, limit markers
- [x] `feature/p4-spectrum-analyzer` — SpectrumAnalyzerPanel: Canvas dark navy, yellow trace, Max Hold, markers, RBW/VBW/Ref
- [x] `feature/p4-oscilloscope` — OscilloscopePanel: green phosphor trace, pulse with droop, draggable cursors
- [x] `feature/p4-multimeter` — MultimeterPanel: 5.5-digit white 7-segment, VDC/Ohms, tolerance bar
- [x] `feature/p4-phase-meter` — PhaseMeterPanel: degree readout, polar plot, freq table, Phase Offset calculator, cable helper (G01-G11) for 110K243
- [x] `feature/p4-network-analyzer` — NetworkAnalyzerPanel: cyan S11, dynamic return loss spec per subsystem (-11.0 K245, -10.0 K243, -18.0 daily cal)
- [x] `feature/p4-fft-display` — FFTDisplayPanel (IF Receiver): dBSat scale, -4.0 target, -60 noise floor, SFDR badge, Ch A/B toggle
- [x] `feature/p4-common-bus` — CommonBusPanel (IF Receiver): shadcn Table R/W, Address hex, Expected/Actual, pass/fail icons

#### Phase 5: Results + Reports + Protection
- [x] `feature/p5-results-page` — ResultsPage with filterable shadcn DataTable + Suspense
- [x] `feature/p5-result-detail` — ResultDetailPage with full data sheet + Suspense
- [x] `feature/p5-pdf-certificate` — PDF certificate generation (reportlab)
- [x] `feature/p5-csv-export` — CSV export
- [x] `feature/p5-hmac-integrity` — HMAC-SHA256 on results + signature hash on completed runs
- [x] `feature/p5-digital-signoff` — `<form action={signAction}>` + useActionState for Engineer sign-off
- [x] `feature/p5-audit-logging` — Append-only audit_log table on all write ops
- [x] `feature/p5-admin-page` — AuditTrailPage (admin only) with timestamp filtering

#### Phase 6: Equipment Integration
- [x] `feature/p6-driver-interface` — InstrumentDriver with send(), query(), reset(), clear_status(), wait_for_completion(), get_error()
- [x] `feature/p6-visa-driver` — VisaDriver wrapping PyVISA (GPIB/USB-TMC/VXI-11) with async executor bridge
- [x] `feature/p6-tcp-scpi-driver` — TcpScpiDriver via asyncio.open_connection() with auto-reconnect
- [x] `feature/p6-driver-factory` — DriverFactory with create_from_mode(), create_from_equipment(), list_available_drivers()
- [x] `feature/p6-equipment-mgmt-ui` — Equipment CRUD API + EquipmentPage.tsx (add/edit/delete/test-connection)
- [x] `feature/p6-equipment-testing` — 57 pytest tests (driver lifecycle, measurements, limits, integrity, factory, full pipeline)

#### Phase 7: Equipment Auto-Detection + Bench
- [x] `feature/p7-autodetect-and-link` — `services/equipment_discovery.py` (parse_idn, infer_instrument_type, discover_visa, discover_lan_mdns). Adds `equipment.instrument_role` column. Endpoints: POST /api/equipment/discover + auto-register. Driver resolution by `step.instrument` → equipment role. EquipmentPage gains Discover dialog + Role column. +17 tests. Adds zeroconf, httpx, checkbox.tsx.
- [x] `feature/p7-equipment-bench` — Equipment Bench page validating instruments vs simulator. Backend `routers/equipment_bench.py`: POST /measure, /simulate, /scpi, WebSocket /ws/equipment/{id} with start_stream/stop_stream/scpi messages. Frontend: side-by-side panels, Recharts rolling chart, stats strip, engineer-gated SCPI console. +9 tests (total 83).
- [x] `feature/p7-equipment-bench-simple` — Operator-friendly redesign: shadcn Select picker → single virtual panel → Start/Stop streaming → role-specific preset buttons → last command/response strip. Hard-coded PRESETS_BY_ROLE. Page shrinks 1101→580 lines.
- [x] `feature/p7-bench-units-and-params` — SI auto-scaling via `lib/units.ts:formatSiValue` (V/A/Ω/Hz/W/s only; dBm/° pass through). Parameterized presets (kind: action/measure/parameter) with inline forms. Adds signal_generator to backend role pattern + model lookups (Keysight N5181B/N5182B/N5183B/N5172B/E8257D/E4438C, R&S SMA100B/SMW200A). SG renders status card (FREQ/POWER/OUTPUT). Page is 734 lines.

#### Phase 8: Dedicated Instrument Bench Page
- [x] `feature/p8-instrument-bench-page` — Standalone `/instrument-bench/:equipmentId?` page. Picker → matching virtual panel → role-keyed presets + raw SCPI box → Verify Accuracy card (expected/tolerance/deviation/log) → Diagnostics card (self-test, *IDN? parser, *STB? bit badges, error queue polling, command history with latency, comms health). Shared `dispatch(label, command, isQuery)` prefers open WS. Connection-status badge with Reconnect. No fake readings (`--` when idle). New `pages/InstrumentBenchPage.tsx`. Sidebar entry "Instrument Bench" (Activity icon, technician+). EquipmentPage gains blue Activity-icon deep-link.

#### Phase 9: Per-Role Bench Pages
- [x] `feature/p9-power-meter-bench` — `PowerMeterBenchPage.tsx` for Keysight N1911A/N1912A: dual-channel 7-segment readouts, Active-Channel selector scoping Frequency/Units (dBm/W)/Averaging/Gain Offset/Math (`CALC`)/Relative/Zero/Cal/Continuous trigger; stats (Avg/Min/Max/Pk-Pk/σ/N) + overlaid Recharts trend (Ch A blue / Ch B amber); Single-shot, refresh rate (250 ms-2 s), 50-row SCPI box. Streams via `pmeter_dual` step type.
- [x] `feature/p9-signal-generator-bench` — `SignalGeneratorBenchPage.tsx` for Keysight MXG N5181B: front-panel-style status, CW Freq (Hz/kHz/MHz/GHz), Amplitude (dBm) + Offset (dB), Sweep card (FREQ:MODE CW/Sweep/List), 4-up Modulation (AM depth+source / FM dev / ΦM dev / Pulse PRF+width), Reference/ALC card, Refresh + Reset (`*RST` + `*CLS`), polling 500 ms-5 s; Diagnostics (`*TST?` + drain on `SYST:ERR?`); 50-row SCPI. Polls via `sg_status` step type.
- [x] `feature/p9-bench-dispatcher` — `BenchDispatcher.tsx` at `/instrument-bench/:equipmentId?` chooses bench by `instrument_role`: multimeter → InstrumentBenchPage (DMM dashboard), power_meter → PowerMeterBenchPage, signal_generator → SignalGeneratorBenchPage. No ID → role-grouped picker. Unknown roles → DMM fallback with banner.
- [x] `feature/p9-driver-step-types` — Added `pmeter_dual` (FETC1?+FETC2?, Ch B errors caught) and `sg_status` (FREQ?/POW?/OUTP?) to both TcpScpiDriver and VisaDriver. Added `_measure_raw_read` to VisaDriver (was only on TcpScpiDriver).

#### Phase 10: ATP Authoring + State Machine + Peer Review + AI
- [x] `feature/p10-atp-schema-migration` — 6 new tables (`atp_definitions`, `atp_steps`, `atp_state_transitions`, `atp_approvals`, `atp_imports`, `atp_simulations`) + idempotent v1→v2 backfill called from main.py lifespan AFTER seed_all. Each v1 procedure becomes rev 'A' / state 'published' / source 'migrated'. v1 tables stay intact (test_runs still FK into them).
- [x] `feature/p10-atp-state-machine` — `services/atp_state_machine.py`: draft → in_review → approved → published → superseded with `_ALLOWED` map + per-transition role checks. Publishing auto-supersedes any sibling rev sharing the same code. Author cannot self-approve. Clone (`create_new_revision`) auto-bumps revision letter A→B→…→Z→AA.
- [x] `feature/p10-atp-step-schema-validation` — `services/atp_validator.py`: known step_type table, required unit + limits for measurement step types, frequency/power requirements per step type, missing-instrument-role detection against `equipment.instrument_role`. Returns list of issues; empty = publishable.
- [x] `feature/p10-atp-peer-review` — `submit_approval` endpoint: pre-flight pass first (state, identity, double-vote-per-round check) → run state transition → only record approval on success. `atp_approvals.review_round` counts in_review transitions; UNIQUE(definition_id, approver_id, review_round) blocks double-voting per round while allowing re-vote after a fix.
- [x] `feature/p10-atp-export-bundle` — `services/atp_bundle.py`: deterministic JSON serialisation (sort_keys, no whitespace) + SHA-256 payload digest + HMAC-SHA-256 over SECRET_KEY. Import lands as a new draft rev under same code. Tampered bundles rejected.
- [x] `feature/p10-atp-revision-diff` — `services/atp_diff.py`: metadata field-by-field diff plus added/removed/modified steps with per-field deltas. Frontend `AtpDiffPage.tsx` renders side-by-side redline.
- [x] `feature/p10-atp-golden-simulation` — `services/atp_simulation.py`: runs steps through `SimulatorDriver` (failure_probability=0, seed=42) and evaluates each measured value against the step's limits. Writes one `atp_simulations` row + per-step JSON.
- [x] `feature/p10-atp-import-docx-pdf` — `services/atp_importer.py` + `routers/atp.py:/imports/upload`: python-docx (paragraphs + table cells) and pdfplumber extraction. Heuristic step splitter on "Step N." patterns. Upload returns preview + heuristic steps; finalize endpoint creates draft.
- [x] `feature/p10-atp-authoring-ui` — three pages:
  - `pages/AtpAuthorPage.tsx` — list view at `/atp-author`, filters (subsystem/state/search), table, "+ New draft" dialog, "Import .docx/.pdf" dialog (heuristic-only or AI-extract), clone / export-bundle / delete-draft actions per row.
  - `pages/AtpDefinitionPage.tsx` — detail/editor at `/atp-author/:id` with tabs (Steps / Metadata / Simulation / History / AI). State-aware action bar (Submit for review / Approve / Reject / Withdraw / Publish / Back-to-draft / Export). Per-step AI safety-warning button. Validation banner. Drag-free step reordering via up/down chevrons.
  - `pages/AtpDiffPage.tsx` — diff view at `/atp-author/diff/:baseId/:targetId` with AI impact summary card + structured metadata-changes / added / removed / modified-with-per-field-deltas tables.
- [x] `feature/p10-ai-extract-steps-from-doc` — `services/ai_atp.py:extract_steps_from_text` via Groq (default model `llama-3.3-70b-versatile`) with `response_format: json_object`. Endpoint `POST /api/atp/ai/extract-from-document` accepts `import_id` (or inline `text`); creates new draft OR appends to existing draft (with optional `replace_existing_steps`). Defaults `step_type='manual_record'` when unsure; re-numbers 1..N defensively.
- [x] `feature/p10-ai-safety-warning-gen` — `draft_safety_warning(step)` → `POST /api/atp/definitions/{id}/steps/{step_id}/ai/safety-warning`. Hazards-aware prompt (RF, HV/HC, ESD, lifting). Returns null when no safety concern.
- [x] `feature/p10-ai-step-ordering-review` — `review_step_ordering(steps)` → `POST /api/atp/definitions/{id}/ai/order-review`. Categories: missing_warmup, missing_settling, dependency_violation, duplicate, safety_gap, limit_mismatch, redundant_stimulus. Returns list with severity + step_numbers + message.
- [x] `feature/p10-ai-revision-impact-summary` — `summarize_revision_impact(diff)` → `POST /api/atp/definitions/{base}/diff/{target}/ai/summary`. Free-form prose, surfaced in AtpDiffPage.

### Current Status
- **Phase**: Phase 10 complete — ATP authoring with state machine, peer review, signed export bundles, DOCX/PDF import, golden simulation, revision diff, and AI assists via Groq (`llama-3.3-70b-versatile`).
- **Main branch**: Phase 1-10 complete. v1 `test_procedures`/`test_steps` remain authoritative for live test runs; v2 `atp_definitions`/`atp_steps` (with 23 migrated rows seeded at boot) drive the new authoring UI. AI features require `GROQ_API_KEY` (auto-loaded from `~/Desktop/.env.local` via python-dotenv, falling back to `backend/.env` and shell env); without the key all four AI endpoints return 503 with a clear message but the rest of the system keeps working.
- **Roles without registered equipment** (would raise `RuntimeError: No active equipment registered with role 'X'` in live mode): `network_analyzer` (40 steps), `oscilloscope` (18 steps), `phase_meter` (8 steps), `spectrum_analyzer` (7 steps), `fft_display` (60 steps), `common_bus` (38 steps)
- **Active worktrees**: None

---

## Maintenance Rules

### CLAUDE.md Update Policy
**This file MUST be updated after every major modification**, including:
- Completing/merging a feature branch
- Adding/removing/changing a dependency
- Modifying project structure
- Changing API routes or database schema
- Updating conventions or coding patterns
- Adding new components or pages
- Architectural decisions that deviate from PROJECT_PLAN.md

**What to update:**
- Check feature checkbox in "Implementation Phases & Features"
- Update "Current Status" section
- Add new files/directories to "Project Structure" if changed
- Add new commands to "Key Commands" if tooling changed
- Update "Technology Stack" if dependencies changed
- Add row to "Architecture Decisions" if deviation occurred

### Architecture Decisions Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-05-07 | Instrument Bench rebuilt as dedicated `/instrument-bench` page with sidebar entry. Adds Diagnostics card + Verify Accuracy card. | User asked for dedicated troubleshooting page. Strict no-fake-readings rule. |
| 2026-05-10 | Replaced preset-button Instrument Bench with the DMM Dashboard layout. Renamed `DmmDashboardPage.tsx` → `InstrumentBenchPage.tsx`. Removed `/live-reading/` and `/dmm-dashboard/` routes. | Consolidate three overlapping bench pages; prefer DMM dashboard's full meter-control layout. |
| 2026-05-10 | Split Instrument Bench into per-role pages via `BenchDispatcher.tsx`: multimeter → InstrumentBenchPage, power_meter → PowerMeterBenchPage, signal_generator → SignalGeneratorBenchPage. New backend step types `pmeter_dual` + `sg_status`. | Each instrument type has fundamentally different controls. User has 3 live instruments and asked for full bench coverage. Single sidebar entry preserved for existing deep-links. |
| 2026-05-10 | Added `sg_setup` step type prepended to every RF-driving procedure so registered SG auto-binds during runs. Drivers send `FREQ`, `POW`, optional `PULM:STAT ON`, `OUTP ON`, then readback. Idempotent `_seed_sg_setup` migration shifts existing step_numbers by +1; step IDs preserved. | Without an SG stimulus step, live RF runs would need manual SCPI beforehand. Explicit step makes binding visible in procedure/data sheet/audit log. |
| 2026-05-10 | TestExecutionPage surfaces equipment binding: new `SignalGeneratorPanel.tsx` (FREQ+AMPL 7-segment, RF/PULSE annunciators) joins 8 panels. `BindingStrip` above every panel shows bound model + address (red "No equipment registered" otherwise). Right sidebar selector tags procedure-required roles as `BOUND`/`NEED`. | Operators couldn't tell which physical instrument was about to be driven. Makes role→equipment mapping first-class. |
| 2026-05-10 | Test Execution panels stream **live readings** via new `useEquipmentLiveReading` hook (one `/ws/equipment/{id}` stream per connected role). DMM locked to VDC by default with auto-switch to current/resistance per step_type; SG reads `FREQ?`/`POW?`/`OUTP?` at 1 Hz; power meter reads `FETC1?`/`FETC2?` at 2 Hz. All synthesised demo values removed. Streams only open in simulator-mode runs (live-mode owned by execution loop). Selector → shadcn DropdownMenu; only **connected** instruments appear. Tags renamed `BOUND`/`NEED` → `CONNECTED`/`IN USE`. | Previous panels showed Gaussian-noise demo numbers. User explicitly requested DMM show VDC + SG show real values + drop unconnected roles. Mirrors no-fake-instruments rule from Instrument Bench. |
| 2026-05-10 | Backported `TcpScpiDriver`'s continuous-mode multimeter handlers into `VisaDriver`: `_MULTIMETER_CONF` lookup, `_ensure_continuous`/`_read_continuous` helpers, and `_measure_mux_voltage`/`_voltage_ac`/`_current_ac`. Refactored `_measure_current` + `_measure_resistance` to same pattern. Reset `_configured_function` on `disconnect()` and `_measure_raw_read`. | Without `_measure_mux_voltage`, vxi11 DMM (34465A) fell through to `_measure_generic` which sent `READ?` against the previous function — panel said VDC but meter stayed on Ohms (returned 9.91E+37 overload sentinel). |
| 2026-05-10 | Test Execution rebuilt as 3-column layout: `[INPUTS] \| [Step + Data Sheet] \| [OUTPUTS]`. Group membership on `EQUIPMENT_PANELS` (`'input'`/`'output'`); signal_generator is the only input. Each side has its own `EquipmentColumnHeader` (blue inputs / emerald outputs) + filtered `EquipmentDropdown`. | Previous single-column rack stacked stimulus + measurement together; control bar scrolled out of view. New layout mirrors physical bench (input source on left, UUT/measurement on right). |
| 2026-05-10 | Auto-resume execution loop on WebSocket connect when run is `'running'` but no in-memory task. Added `has_running_task(run_id)` to `services/execution_runner.py`; `/ws/test/{id}` calls `start_execution(engine, run_id)` after `load_existing_run` when needed. | After FastAPI restart or WS crash, run's DB row stayed `'running'` but `_running_tasks`/`_step_triggers` were empty — Take Measurement clicks silently returned False. |
| 2026-05-10 | Shared driver session between bench WebSocket and execution-runner. New `services/active_drivers.py` registry of `equipment_id → InstrumentDriver` + per-equipment `asyncio.Lock`. Bench WS publishes driver on `start_stream`, unregisters on `stop_stream`/disconnect. `_resolve_driver_for_step` no longer special-cases simulator-mode — if real equipment registered for role, always uses it. VisaDriver/TcpScpiDriver `_measure_output_power` switched from `MEAS:POW?` to `INIT1:CONT ON` + `FETC1?` to match `pmeter_dual`. | Two separate sessions caused recorded measurement to differ from on-screen reading — each ran its own `ABOR`+`CONF` reset and fired its own `READ?` at slightly different times. One shared session + lock = single SCPI command in flight at a time. |
| 2026-05-10 | Test Execution layout: page is fixed-height (`h-[calc(100vh-3rem)]`); only data sheet in middle column scrolls (`flex-1 min-h-0 overflow-y-auto`). Removed `sticky top-[132px]` workarounds from asides. | Previous sticky approach had magic offsets tracking topbar height; scrollbar lived on page edge instead of data sheet. Viewport-constrained page = WYSIWYG. |
| 2026-05-10 | Round displayed readings to 2 decimal places. `MultimeterPanel.formatDisplayValue` returns `value.toFixed(2)` (with `OL` shortcut for Truevolt 9.91E+37 overload). `SignalGeneratorPanel.scaleFrequency` uses `.toFixed(2)`. `DataSheetPreview` Measured column uses `Number(measured_value).toFixed(2)`. | Recorded values must match live panel readings. With shared driver session there's still sub-ms timing noise; rounding makes display deterministic. |
| 2026-05-11 | `_run_steps` retunes SG before every step whose `frequency_mhz`/`input_power_dbm` differs from currently-tracked state, calling `driver.measure("sg_setup", params)` on shared session via `active_drivers`. Retune fires BEFORE `_wait_for_step_trigger` so operator sees new FREQ/AMPL before clicking Take. New `MIN_STEP_DELAY_S = 3.0` clamp in `set_run_mode()`; manual `_wait_for_step_trigger` sleeps `delay` seconds AFTER trigger fires. `TestControlBar.tsx` Delay input gets `onBlur` clamp + `clampDelay` helper; label `3 sec min`. | K243-FINAL had Step 1 program SG to 2800 MHz/0 dBm then never reprogrammed — later steps (3100 MHz, Return Loss sweep, +49.5/+50.5 dBm Output Power) measured at wrong stimulus. Initial fix used wrong call signature; debug prints uncovered it. After fix, power meter jumped ~0.7 dBm → ~+20 dBm (N5181B ceiling). 3 s minimum protects SG synthesizer/ALC loop and gives operator visible time to verify each stimulus. |
| 2026-05-12 | New `services/equipment_autoregister.py:reconcile_equipment_with_network()` runs on backend startup (fire-and-forget via `schedule_startup_reconcile()` in `main.py`'s `lifespan`) and is exposed at `POST /api/equipment/reconcile`. Matches discovered instruments to `equipment` rows by `*IDN?` serial number: heals stale `connection_address` to whatever the local network advertises, inserts new instruments, deactivates active rows whose serial wasn't seen, and dedups duplicate rows for the same serial. `EquipmentPage.tsx` gets a new "Rescan Network" button + result alert. | The EXE ships `atp.db` with the build PC's cached link-local IPs (`169.254.x.x`). On a different bench those addresses aren't on any local subnet, so the HiSLIP socket fails with WinError 10051 before any test can run. Serial number is an instrument property, not a network property — so matching on serial lets the same physical instrument follow the operator to any PC without manual reconfiguration. No IPs are hardcoded anywhere; mDNS + PyVISA enumerate whatever is reachable. |
| 2026-05-17 | Phase 10 ATP authoring built on a parallel v2 schema (`atp_definitions`/`atp_steps`) rather than mutating `test_procedures`/`test_steps`. v1 tables stay intact because `test_runs` and `test_results` FK into them; new authoring lives alongside via `legacy_procedure_id` linkage. Idempotent backfill runs from `lifespan` after `seed_all` (init_db runs first and v1 tables haven't been populated yet). | Mutating v1 would have required either rewriting every historical row's foreign keys (high blast radius) or accepting that mid-flight test runs would break on restart. Parallel schema = zero risk to historical data, clean separation between "what gets executed today" and "what is being drafted for tomorrow", and the migration is reversible by simply dropping the v2 tables. |
| 2026-05-17 | Peer-review approvals track `review_round` (count of `in_review` transitions) instead of timestamp; UNIQUE constraint includes round so the same engineer can vote again after a fix-and-resubmit but not twice on the same round. | First implementation tried timestamp comparison (`decided_at >= latest_in_review_at`) but SQLite `datetime('now')` is second-precision — fast test runs where transitions and approvals happened in the same second saw spurious "you already voted" errors. Explicit round counter eliminates the race and makes the data model obvious to readers. |
| 2026-05-17 | Approval handler runs the state-machine transition FIRST and only records the `atp_approvals` row on success. | The original implementation inserted the approval row then called `transition()`. When validation rejected the approve (409), the approval row was already persisted, so retrying with `reject` after fixing the validation issue tripped the UNIQUE constraint and the engineer was permanently locked out of voting again on that round. |
| 2026-05-17 | AI features (extract-steps, safety-warning, ordering-review, impact-summary) call Groq via OpenAI-wire-compatible `chat/completions` (`https://api.groq.com/openai/v1`) with `response_format: json_object` for the three structured outputs and plain prose for the impact summary. Default model `llama-3.3-70b-versatile`. `GROQ_API_KEY` is auto-loaded by `config.py` (using python-dotenv) from `backend/.env`, repo-root `.env`, or `~/Desktop/.env.local` — first one found wins per key, no override of shell env. Without the key every AI endpoint returns 503 with a clear message; nothing else breaks. | Groq is the user's chosen provider (key already lived in their global `~/Desktop/.env.local`). Llama-3.3-70b is fast on Groq's hardware and reliable at structured JSON output. The OpenAI wire format means a single tiny HTTP wrapper covers both JSON and prose modes; no SDK dependency. Auto-loading the user's existing global env file means zero per-project key duplication. Failing soft (503 with explanation) means the AI layer is genuinely opt-in — the rest of Phase 10 (authoring, peer review, diff, sim, import, export) all work with the key absent. |

### Known Issues

| Issue | Severity | Related Feature |
|-------|----------|----------------|
| — | — | — |
