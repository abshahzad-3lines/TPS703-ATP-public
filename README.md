# TPS-703 ATP Automation System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://python.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![TypeScript 5+](https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Status: Complete](https://img.shields.io/badge/Status-Complete-brightgreen)]()

---

## Overview

**TPS-703 ATP** is a web-based Acceptance Test Procedure (ATP) automation system for TPS-703 radar transmitter subsystems manufactured by Northrop Grumman (CAGE Code 97942). It replaces manual paper-based ATP workflows with a digital system that enforces test sequencing, captures measurements in real time, validates results against specification limits, and produces tamper-evident test certificates.

The system manages acceptance testing for **four S-band (2.8--3.1 GHz) radar subsystems**:

| Drawing No. | Subsystem | Assembly | Output |
|-------------|-----------|----------|--------|
| **110K245** | Power Module Assembly | 100K517 | 724 W |
| **110K244** | Preamplifier Panel Assembly | 100K520 | 1,531 W |
| **110K243** | RF Output Panel Assembly | 100K515 | 2,512 W |
| **IF Receiver** | Digital IF Receiver Assembly | -- | IQ data processing |

---

## Screenshots

> **Note:** Replace the placeholder paths below with actual screenshots of the running application.

| View | Description |
|------|-------------|
| ![Dashboard](docs/screenshots/dashboard.png) | **Dashboard** -- Subsystem status cards for all four modules, recent test activity table, and daily calibration validity countdown. |
| ![Test Execution](docs/screenshots/test-execution.png) | **Test Execution** -- Three-column layout with step instructions, live virtual instrument panels (oscilloscope, spectrum analyzer, power meter, etc.), and real-time progress tracker. |
| ![Results](docs/screenshots/results.png) | **Results** -- Filterable data table of completed test runs with pass/fail status, digital sign-off state, and export options. |
| ![Audit Trail](docs/screenshots/audit-trail.png) | **Audit Trail** -- Append-only log of all write operations with timestamp filtering, available to Admin role only. |

---

## Key Features

### Test Execution
- **State machine engine** with well-defined transitions: Pending --> Running --> Paused / Passed / Failed / Aborted
- **Automatic and manual execution modes** with per-step pause/resume control
- **WebSocket live updates** push measurement data and status changes to the browser in real time
- **Simulator driver** generates realistic measurements with controlled Gaussian variance for development and training

### Virtual Instrument Panels (8 panels)
- **PowerMeterPanel** -- 7-segment amber CSS readout with horizontal bar graph and limit markers
- **SpectrumAnalyzerPanel** -- Canvas dark navy background, yellow trace with glow effect, Max Hold orange trace, RBW/VBW/Ref labels
- **OscilloscopePanel** -- Canvas green phosphor trace on dark grid, pulse shape with droop visualization, draggable cursors for pulse width measurement
- **MultimeterPanel** -- 5.5-digit 7-segment white display, VDC/Ohms mode switching, tolerance bar with green acceptable zone
- **PhaseMeterPanel** -- Semicircular analog gauge with numeric degree readout, frequency table, Phase Offset calculator, cable selection helper (G01--G11)
- **NetworkAnalyzerPanel** -- Canvas dark blue-black background, cyan S11 trace, dynamic return loss spec line per subsystem, multi-trace overlay at different drive levels
- **FFTDisplayPanel** -- Canvas dBSat scale with target and noise floor lines, SFDR badge, Channel A/B toggle (IF Receiver)
- **CommonBusPanel** -- Tabular R/W register display with address hex, expected vs. actual data, and pass/fail row coloring (IF Receiver)

### Data Integrity
- **HMAC-SHA256** integrity hashes on individual measurement results
- **Signature hash** on completed test runs for tamper detection
- **Immutable results** -- once recorded, test data cannot be modified
- **Digital sign-off workflow** with Engineer-level authorization

### Reporting
- **PDF test certificates** generated with reportlab, matching the original ATP document format
- **CSV data export** for post-processing and external analysis

### Equipment Integration
- **VISA/GPIB driver** via PyVISA for GPIB, USB-TMC, and VXI-11 instruments
- **TCP/SCPI driver** with async socket connections and auto-reconnect
- **Simulator driver** for offline development and operator training
- **Driver factory** with mode-based and equipment-based driver instantiation

### Access Control
- **Four-tier role hierarchy**: Admin > Engineer > Technician > Viewer
- **JWT authentication** with token refresh and role-based middleware
- **Protected routes** enforce minimum role requirements per page

### Audit Trail
- **Append-only audit log** captures all write operations with user, action, entity, and timestamp
- **Admin-only Audit Trail page** with timestamp range filtering

### Calibration Management
- **24-hour calibration expiry** with automatic validity checking
- **Daily calibration workflow** with parameter templates and equipment tracking
- **Calibration status dashboard** with countdown timer

---

## Tech Stack

### Backend

| Component | Technology |
|-----------|------------|
| Framework | Python 3.11+ / FastAPI |
| Database | SQLite via aiosqlite |
| Authentication | JWT (python-jose) + passlib[bcrypt] |
| PDF Generation | reportlab |
| Equipment I/O | PyVISA (GPIB/VISA) + SCPI over TCP |
| Real-time | WebSocket (FastAPI native) |
| Validation | Pydantic 2.0 |
| Server | uvicorn |
| Testing | pytest + pytest-asyncio (57 tests) |

### Frontend

| Component | Technology |
|-----------|------------|
| Framework | React 19 + TypeScript 5+ |
| Build Tool | Vite 5+ |
| UI Library | shadcn/ui (Radix UI + Tailwind CSS) |
| Charts | Recharts (structured data) |
| Waveforms | HTML5 Canvas (oscilloscope, spectrum analyzer, network analyzer, FFT) |
| State Management | Zustand |

---

## React 19 Features Used

This project serves as a comprehensive showcase of **React 19** patterns, avoiding legacy APIs entirely:

| Feature | Usage |
|---------|-------|
| `useActionState` | Form submissions on Login, Test Setup, Digital Sign-off -- replaces manual `isPending`/`error` state |
| `useFormStatus` | Shared `SubmitButton` component reads parent `<form>` pending state without prop drilling |
| `useOptimistic` | Instant UI feedback for UUT serial number registration and test parameter adjustments |
| `use()` with Suspense | Data loading via `use(promise)` for Results page, Result Detail, Recent Tests table |
| `useDeferredValue` | Smooth instrument panel transitions during high-frequency measurement updates |
| `<Context value={}>` | Direct context rendering without `.Provider` wrapper (Auth, Test, Theme contexts) |
| `ref` as regular prop | No `forwardRef` -- Canvas refs passed directly to instrument panel function components |
| Ref cleanup functions | Canvas refs return cleanup functions instead of null-checking |
| Document metadata | `<title>` rendered directly in component JSX, auto-hoisted to `<head>` |
| `createRoot` error handlers | `onCaughtError`, `onUncaughtError`, `onRecoverableError` configured in main.tsx |

---

## Project Structure

```
TPS703-ATP/
|-- README.md
|-- CLAUDE.md                          # Development guide and project state
|-- start.bat                          # One-click launcher (Windows)
|
|-- tps703-atp/
    |-- backend/
    |   |-- main.py                    # FastAPI app with CORS and lifespan
    |   |-- config.py                  # Application settings
    |   |-- database.py                # SQLite connection and schema (12 tables)
    |   |-- seed_data.py               # Subsystem/procedure/step seed data
    |   |-- requirements.txt           # Python dependencies
    |   |-- pytest.ini                 # Test configuration
    |   |
    |   |-- auth/
    |   |   |-- router.py              # Login, refresh, user management
    |   |   |-- dependencies.py        # JWT verification middleware
    |   |   |-- models.py              # Auth Pydantic models
    |   |   |-- utils.py               # Password hashing, token generation
    |   |
    |   |-- routers/
    |   |   |-- subsystems.py          # GET subsystems and procedures
    |   |   |-- uuts.py                # UUT registration and history
    |   |   |-- calibrations.py        # Calibration CRUD and validation
    |   |   |-- test_runs.py           # Test run lifecycle management
    |   |   |-- results.py             # Test results retrieval
    |   |   |-- equipment.py           # Equipment CRUD and connection testing
    |   |   |-- exports.py             # CSV and PDF export endpoints
    |   |   |-- audit.py               # Audit log queries
    |   |   |-- analytics.py           # Dashboard analytics
    |   |
    |   |-- services/
    |   |   |-- test_engine.py         # State machine for test execution
    |   |   |-- execution_runner.py    # Orchestrates step-by-step execution
    |   |   |-- step_executor.py       # Individual step measurement logic
    |   |   |-- pdf_generator.py       # Reportlab PDF certificate builder
    |   |   |-- audit.py               # Audit log write service
    |   |
    |   |-- drivers/
    |   |   |-- __init__.py            # DriverFactory class
    |   |   |-- base.py                # Abstract InstrumentDriver interface
    |   |   |-- simulator.py           # SimulatorDriver with Gaussian variance
    |   |   |-- visa_driver.py         # PyVISA driver (GPIB/USB-TMC/VXI-11)
    |   |   |-- tcp_scpi_driver.py     # Async TCP SCPI driver with reconnect
    |   |
    |   |-- websocket/
    |   |   |-- routes.py              # /ws/test/{id} WebSocket endpoint
    |   |   |-- manager.py             # Connection management
    |   |
    |   |-- tests/
    |       |-- conftest.py            # Shared fixtures
    |       |-- test_equipment_integration.py  # 57 integration tests
    |
    |-- frontend/
        |-- index.html
        |-- vite.config.ts
        |-- tailwind.config.ts
        |-- tsconfig.json
        |
        |-- src/
            |-- main.tsx               # createRoot with React 19 error handlers
            |-- App.tsx                # Router and page layout
            |-- index.css              # Tailwind base styles
            |
            |-- contexts/
            |   |-- AuthContext.ts      # Authentication state
            |   |-- TestContext.ts      # Test execution state
            |   |-- ThemeContext.ts     # Light/dark theme state
            |
            |-- pages/
            |   |-- LoginPage.tsx
            |   |-- DashboardPage.tsx
            |   |-- TestSetupPage.tsx
            |   |-- TestExecutionPage.tsx
            |   |-- ResultsPage.tsx
            |   |-- ResultDetailPage.tsx
            |   |-- EquipmentPage.tsx
            |   |-- AuditTrailPage.tsx
            |
            |-- components/
                |-- layout/
                |   |-- AppShell.tsx         # Sidebar, header, role badge
                |   |-- ProtectedRoute.tsx   # Role-based route guard
                |   |-- SubmitButton.tsx      # useFormStatus shared button
                |
                |-- dashboard/
                |   |-- ModuleStatusCard.tsx
                |   |-- RecentTestsTable.tsx
                |   |-- CalibrationStatus.tsx
                |   |-- CalibrationForm.tsx
                |   |-- UUTRegistrationForm.tsx
                |
                |-- test/
                |   |-- StepPanel.tsx
                |   |-- TestControlBar.tsx
                |   |-- TestProgressBar.tsx
                |   |-- ParameterInput.tsx
                |   |-- StatusBadge.tsx
                |   |-- DataSheetPreview.tsx
                |   |-- ConnectionSetup.tsx
                |   |-- SignOffForm.tsx
                |
                |-- instruments/
                |   |-- InstrumentRack.tsx
                |   |-- InstrumentMonitorWindow.tsx
                |   |-- PowerMeterPanel.tsx
                |   |-- SpectrumAnalyzerPanel.tsx
                |   |-- OscilloscopePanel.tsx
                |   |-- MultimeterPanel.tsx
                |   |-- PhaseMeterPanel.tsx
                |   |-- NetworkAnalyzerPanel.tsx
                |   |-- FFTDisplayPanel.tsx
                |   |-- CommonBusPanel.tsx
                |
                |-- ui/                # shadcn/ui primitives
```

---

## Getting Started

### Prerequisites

- **Python** 3.11 or higher
- **Node.js** 18+ and npm
- **Git**

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/KK-SP/TPS703-ATP.git
cd TPS703-ATP
```

**2. Set up the backend**

```bash
cd tps703-atp/backend
python -m venv venv

# Activate the virtual environment
source venv/Scripts/activate    # Windows (Git Bash)
source venv/bin/activate        # macOS / Linux

pip install -r requirements.txt
```

**3. Set up the frontend**

```bash
cd tps703-atp/frontend
npm install
```

### Running the Application

**Option A: One-click launcher (Windows)**

Double-click `start.bat` in the project root. It starts both servers, installs dependencies if needed, and opens the browser.

**Option B: Manual startup**

Terminal 1 -- Backend:
```bash
cd tps703-atp/backend
source venv/Scripts/activate    # or venv/bin/activate on macOS/Linux
uvicorn main:app --reload --port 8005
```

Terminal 2 -- Frontend:
```bash
cd tps703-atp/frontend
npm run dev -- --port 5173
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### Access Points

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8005 |
| API Documentation | http://localhost:8005/docs |
| WebSocket | ws://localhost:8005/ws/test/{id} |

---

## Default Credentials

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |

> **Important:** Change the default password before any production or lab deployment.

---

## API Documentation

FastAPI provides interactive API documentation automatically:

- **Swagger UI** -- [http://localhost:8005/docs](http://localhost:8005/docs)
- **ReDoc** -- [http://localhost:8005/redoc](http://localhost:8005/redoc)

### Endpoint Groups

| Prefix | Description |
|--------|-------------|
| `POST /api/auth/login` | JWT login and token refresh |
| `GET /api/subsystems` | Subsystem definitions and linked procedures |
| `POST /api/uuts` | Unit Under Test registration and history |
| `POST /api/calibrations` | Calibration management with 24h expiry |
| `POST /api/test-runs` | Test run lifecycle (create, start, pause, abort) |
| `GET /api/results` | Query immutable test results |
| `GET /api/equipment` | Equipment CRUD and connection testing |
| `GET /api/exports` | PDF certificate and CSV data export |
| `GET /api/audit` | Audit log queries (admin only) |
| `GET /api/analytics` | Dashboard statistics |
| `ws://…/ws/test/{id}` | WebSocket for live test data streaming |

---

## Database Schema

The system uses SQLite with 12 tables:

| Table | Purpose |
|-------|---------|
| `users` | User accounts with role (admin, engineer, technician, viewer) |
| `subsystems` | Radar subsystem definitions (110K245, 110K244, 110K243, IF Receiver) |
| `units_under_test` | UUT serial number registration linked to subsystems |
| `test_procedures` | ATP procedure definitions with section references and warmup times |
| `test_steps` | Individual test steps with instrument, limits, and instructions |
| `calibrations` | Daily calibration records with 24-hour expiry tracking |
| `calibration_results` | Per-parameter calibration measurements |
| `calibration_equipment` | Junction table linking calibrations to equipment used |
| `test_runs` | Test execution instances with status, mode, and HMAC signature |
| `test_results` | Immutable measurement records with integrity hashes |
| `equipment` | Instrument inventory with connection details and cal due dates |
| `audit_log` | Append-only log of all write operations |

---

## Architecture

```
+---------------------------------------------------+
|                    Browser                         |
|                                                    |
|  React 19 + shadcn/ui + Recharts + Canvas          |
|  Zustand state | WebSocket client                  |
+-------------------+------+------------------------+
                    |      |
              HTTP REST   WebSocket
                    |      |
+-------------------v------v------------------------+
|                  FastAPI                           |
|                                                    |
|  Auth Middleware (JWT)                              |
|  +----------------------------------------------+ |
|  |  Routers                                      | |
|  |  subsystems | uuts | calibrations | test_runs | |
|  |  results | equipment | exports | audit        | |
|  +---------------------+------------------------+ |
|                         |                          |
|  +---------------------v------------------------+ |
|  |  Services                                     | |
|  |  TestEngine (state machine)                   | |
|  |  ExecutionRunner --> StepExecutor              | |
|  |  PDFGenerator | AuditService                  | |
|  +---------------------+------------------------+ |
|                         |                          |
|  +---------------------v------------------------+ |
|  |  Drivers                                      | |
|  |  SimulatorDriver | VisaDriver | TcpScpiDriver | |
|  |  DriverFactory                                | |
|  +---------------------+------------------------+ |
|                         |                          |
+-------------------+-----+-----+-------------------+
                    |           |
          +---------v--+  +----v-----------+
          |  SQLite DB  |  |  Instruments   |
          |  (aiosqlite)|  |  GPIB / TCP    |
          |  12 tables  |  |  SCPI / VISA   |
          +-------------+  +----------------+
```

### Data Flow

1. **User** authenticates via JWT and selects a subsystem, procedure, and UUT.
2. **TestEngine** transitions the test run through its state machine (pending --> running --> passed/failed).
3. **ExecutionRunner** iterates through test steps, delegating measurements to the active **Driver** (Simulator, VISA, or TCP/SCPI).
4. **StepExecutor** captures the measurement, evaluates it against specification limits, computes an HMAC-SHA256 integrity hash, and stores the immutable result.
5. **WebSocket** broadcasts each result to connected browser clients in real time.
6. **Virtual instrument panels** render the incoming data using Recharts charts and HTML5 Canvas waveforms.
7. On completion, a **signature hash** seals the entire test run, and an **Engineer sign-off** can be applied.
8. **PDF certificates** and **CSV exports** are generated on demand from the immutable result set.

---

## Deployment

### Local Development (Current Setup)

The system runs as two local processes (backend on port 8005, frontend on port 5173) with SQLite as the database. Use `start.bat` on Windows for one-click startup.

### Docker Deployment

```dockerfile
# Backend
FROM python:3.11-slim
WORKDIR /app
COPY tps703-atp/backend/ .
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```dockerfile
# Frontend
FROM node:20-alpine AS build
WORKDIR /app
COPY tps703-atp/frontend/ .
RUN npm ci && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

Use Docker Compose to orchestrate both services together, mapping ports and mounting the SQLite database volume.

### Cloud Deployment

The application can be deployed to platforms such as:

- **Render** -- Deploy the FastAPI backend as a Web Service and the frontend as a Static Site.
- **Railway** -- Deploy both services from a monorepo with separate service definitions.
- **Azure App Service / AWS ECS** -- Containerized deployment using the Dockerfiles above.

> **Note:** For production deployments, consider migrating from SQLite to PostgreSQL and adding HTTPS termination.

---

## Testing

Run the backend integration tests:

```bash
cd tps703-atp/backend
source venv/Scripts/activate    # or venv/bin/activate
pytest -v
```

The test suite includes **57 tests** covering:
- Driver lifecycle (connect, measure, disconnect)
- All measurement types (power, frequency, pulse width, phase, VSWR, etc.)
- Limit evaluation (pass, fail, min-only, max-only, tolerance)
- HMAC-SHA256 integrity hashing
- Driver factory instantiation
- Full execution pipeline (end-to-end test run)

---

## Contributing

1. **Fork** the repository.
2. **Create a feature branch** from `main`: `git checkout -b feature/your-feature`.
3. **Implement** your changes following the project conventions documented in `CLAUDE.md`.
4. **Write tests** for new backend functionality.
5. **Run the test suite** and verify all tests pass.
6. **Submit a pull request** with a clear description of the changes.

### Development Notes

- The project uses an **isolated worktree workflow** -- each feature is developed in its own git worktree, tested independently, then merged into `main`.
- Branch naming convention: `feature/<phase>-<short-description>`.
- All test results are **immutable** -- the schema and application logic enforce this invariant.
- Follow the **React 19 conventions** documented in `CLAUDE.md` -- no `forwardRef`, no `.Provider`, use `useActionState` for forms.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  <strong>TPS-703 ATP Automation System</strong><br>
  Acceptance Test Procedure Automation for S-Band Radar Transmitter Subsystems<br>
  CAGE Code 97942
</p>
