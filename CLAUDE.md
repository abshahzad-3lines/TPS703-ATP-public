# TPS-703 ATP Automation System

## Project Overview
Web-based Acceptance Test Procedure (ATP) automation system for the TPS-703 radar transmitter subsystems manufactured by Northrop Grumman (CAGE Code 97942). The system manages acceptance testing for 4 radar subsystems operating in S-band (2.8-3.1 GHz).

## Technology Stack
- **Backend**: Python 3.11+ / FastAPI
- **Frontend**: React 19 + TypeScript 5+ + Vite 5+
- **UI Library**: shadcn/ui (Radix UI + Tailwind CSS)
- **Instrument Visualization**: Recharts (structured data) + HTML5 Canvas (waveforms)
- **State Management**: Zustand
- **Database**: SQLite via aiosqlite
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
- Role hierarchy: Admin > Engineer > Technician > Viewer
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

### Current Status
- **Phase**: Phase 9 complete + SG per-step retune + 3s settling delay + portable equipment reconcile
- **Main branch**: Phase 1-9 complete + SG binding + equipment auto-reconcile on startup. Three active instruments (34465A multimeter, N1912A power meter, N5181B signal generator) auto-bind via `_resolve_driver_for_step`; their `connection_address` values are healed by serial number on every backend startup so cached IPs from the build machine never travel with the installer. Backend test suite 81/83 (pre-existing `parse_idn` failures, no regressions).
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

### Known Issues

| Issue | Severity | Related Feature |
|-------|----------|----------------|
| — | — | — |
