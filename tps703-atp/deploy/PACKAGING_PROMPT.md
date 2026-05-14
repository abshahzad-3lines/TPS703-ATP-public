# TPS-703 ATP — Windows Packaging Agent Prompt

Hand this whole file to an agent (`Agent` tool, `general-purpose`). It is self-contained — the agent does not need to read prior chat to do the job.

---

## Your mission

Produce a **single Windows installer** (`TPS703-Setup-1.0.0.exe`, ~80–120 MB) that a non-technical test technician can copy from a USB stick onto a **completely bare Windows 10 / 11 PC** (no Python, no Node, no Keysight IO Libraries, no .NET, no anything) and have the TPS-703 ATP system running in under a minute by double-clicking and clicking Next a few times.

**Hard constraints — read twice:**

1. **DO NOT modify any file under `tps703-atp/backend/` or `tps703-atp/frontend/`.** All deployment work lives inside `tps703-atp/deploy/`. The main app code is sacred — packaging adapts to it, not the other way around.
2. **DO NOT commit to `main`.** Create a branch (e.g. `feature/p10-windows-installer`) via `isolation: "worktree"` and do all work there. The user will review and merge later.
3. **DO NOT install Python / Node / Keysight IOLS on the target PC.** Everything ships inside the installer.

## The application (context for the agent)

- **Backend**: Python 3.11 / FastAPI / uvicorn / aiosqlite / pyvisa. Source at `tps703-atp/backend/`. Entry point is `main:app`. Default port 8005. Database is a single SQLite file `atp.db` in the backend working directory.
- **Frontend**: React 19 / Vite 5 / TypeScript / Tailwind / shadcn. Source at `tps703-atp/frontend/`. Build with `npm ci && npm run build` → emits `frontend/dist/`.
- **Instruments**: Keysight N5181B signal generator, N1912A power meter, 34465A multimeter — all on LAN as `TCPIP::169.254.x.x::INSTR` (VXI-11 / SCPI-RAW). The user has confirmed no GPIB and no USB-TMC instruments anywhere on the bench.

## Recommended stack (use this — don't go shopping)

| Layer | Tool | Why |
|---|---|---|
| VISA backend | **`pyvisa-py`** (pure Python) | Replaces Keysight IOLS entirely. Supports VXI-11 + SCPI-RAW. Eliminates ~200 MB vendor runtime, .NET 3.5 prerequisite, and a redistribution licensing question. |
| Python bundling | **PyInstaller** (one-folder, `--noconsole`) | Mature uvicorn/FastAPI hooks, fast CI builds, large community. Nuitka's runtime speedup is irrelevant for an I/O-bound SCPI app. |
| Frontend serving | **FastAPI `StaticFiles`** mounted by the launcher script | One process to launch. No Tauri / Electron — the technician already has Edge. |
| Service wrapper | **NSSM** | Registers the EXE as a Windows service with restart-on-crash. Bundle `nssm.exe` in `deploy/vendor/`. |
| Installer | **Inno Setup** (compiled with `iscc.exe`) | Produces a self-contained signed EXE. Pascal-script section handles prerequisites, `[Files]` flags preserve `atp.db` on upgrade. |
| MSVC runtime | **`VC_redist.x64.exe`** chain-installed silently | Required by the PyInstaller-bundled Python wheels on older Win10 builds. ~14 MB, no-op if already present. |

## Required deliverables (all inside `tps703-atp/deploy/`)

```
tps703-atp/deploy/
├── PACKAGING_PROMPT.md          (this file — do not modify)
├── README.md                    (build + install + update guide for the dev team)
├── launcher.py                  (entry point bundled by PyInstaller)
├── tps703-atp.spec              (PyInstaller spec — explicit hidden_imports)
├── installer.iss                (Inno Setup script)
├── build.ps1                    (one-shot: vite build → copy → pyinstaller → iscc)
├── vendor/                      (third-party binaries — DO commit, see Note 3)
│   ├── nssm.exe                 (download from nssm.cc — pin v2.24)
│   └── VC_redist.x64.exe        (download from Microsoft — pin a version)
└── dist/                        (gitignored — output goes here)
    ├── tps703-atp/              (PyInstaller output folder)
    └── TPS703-Setup-1.0.0.exe   (final installer)
```

### `launcher.py` — the only place pyvisa-py is selected and StaticFiles is mounted

Because we can't touch `backend/`, the launcher does the job:

```python
import os
import sys
from pathlib import Path

# 1. Tell pyvisa to use the pure-Python backend BEFORE backend.main imports it.
os.environ["PYVISA_LIBRARY"] = "@py"

# 2. Make backend.* importable when the bundle runs from PyInstaller's _MEIPASS.
HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)).resolve()
sys.path.insert(0, str(HERE / "backend"))

# 3. Resolve user data directory (atp.db lives here, NOT in Program Files).
APPDATA = Path(os.environ["APPDATA"]) / "TPS-703"
APPDATA.mkdir(parents=True, exist_ok=True)
os.chdir(APPDATA)   # backend opens atp.db with a relative path — chdir does it

# 4. Import the FastAPI app and mount the SPA on top of it.
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
from starlette.requests import Request
from main import app  # noqa: E402

STATIC_DIR = HERE / "static"

class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except Exception:
            return FileResponse(STATIC_DIR / "index.html")

# Mount AFTER all /api and /ws routes are registered — they take precedence.
app.mount("/", SPAStaticFiles(directory=str(STATIC_DIR), html=True), name="spa")

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8005, log_level="info")
```

This pattern means **zero source-file changes** in `backend/`. Verify by running `git status` after wiring it up — only `deploy/*` should appear.

### `tps703-atp.spec` essentials

- `--onedir --noconsole --name tps703-atp`
- `hiddenimports`: `uvicorn.logging`, `uvicorn.loops.auto`, `uvicorn.protocols.http.auto`, `uvicorn.protocols.websockets.auto`, `uvicorn.lifespan.on`, plus `collect_submodules('uvicorn')`, `collect_submodules('pyvisa')`, `collect_submodules('pyvisa_py')`.
- `datas`: `[('static', 'static')]` (the copied Vite `dist/`).
- Add `pyusb`, `psutil`, `zeroconf` to hidden imports if `pyvisa-py` complains at runtime.

### `installer.iss` essentials

- `AppId={{a unique GUID}}` — never change once shipped.
- `DefaultDirName={autopf}\TPS-703` (Program Files\TPS-703).
- `[Files]` for `atp.db` template: `DestDir: "{userappdata}\TPS-703"; Flags: onlyifdoesntexist uninsneveruninstall` — **never overwritten on upgrade, never deleted on uninstall**. If you don't ship a default `atp.db`, skip this and let the backend create it on first boot.
- `[Run]` chain in this order: `VC_redist.x64.exe /install /quiet /norestart` → `nssm install TPS703-ATP "{app}\tps703-atp.exe"` → `nssm set TPS703-ATP AppDirectory "{app}"` → `nssm start TPS703-ATP` → `netsh advfirewall firewall add rule name="TPS-703 ATP" dir=in action=allow program="{app}\tps703-atp.exe" enable=yes`.
- `[UninstallRun]` mirror: `nssm stop TPS703-ATP`, `nssm remove TPS703-ATP confirm`, firewall delete rule.
- `[Icons]` Start Menu + Desktop shortcuts pointing at `msedge.exe --app=http://127.0.0.1:8005` (gives a chromeless app-mode window — nicer than a tab).

### `build.ps1` — the one command the dev team runs

```powershell
# 1. Build the SPA
Push-Location ..\frontend; npm ci; npm run build; Pop-Location

# 2. Copy dist into deploy/static (PyInstaller picks it up via the spec's `datas`)
Remove-Item -Recurse -Force .\static -ErrorAction SilentlyContinue
Copy-Item -Recurse ..\frontend\dist .\static

# 3. Bundle Python + backend + static
Remove-Item -Recurse -Force .\dist -ErrorAction SilentlyContinue
pyinstaller .\tps703-atp.spec --noconfirm

# 4. Compile the installer
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" .\installer.iss
```

## Required smoke tests before declaring done

1. **pyvisa-py works on the real bench**: in the project venv, run a tiny script that does `pyvisa.ResourceManager('@py').open_resource('TCPIP::169.254.129.175::INSTR').query('*IDN?')` against the N5181B and prints the response. Confirm with the user before bundling. If ANY one instrument fails, fall back to bundling Keysight IOLS for that vendor (document this in `deploy/README.md`).
2. **Clean-VM install test**: spin up a Hyper-V / VirtualBox Windows 10 21H2 VM with NO software added beyond the OS. Copy `TPS703-Setup-1.0.0.exe` over → install → confirm the desktop shortcut launches a working app and `*IDN?` works against a bench instrument reachable from the VM.
3. **Upgrade test**: install v1.0.0 → log in → start a test → install v1.0.1 (rebuild with a bumped version string in `installer.iss`) on top → confirm `atp.db` still has the same UUTs / runs / users.

## Documentation deliverables

- `deploy/README.md`: dev-team build steps (the single `.\build.ps1` line, prerequisites: Python 3.11 + Node 20 + Inno Setup 6 installed on the build machine), code-signing notes, version bumping checklist.
- After the branch merges, append a single row to the **Architecture Decisions Log** table in the project root `CLAUDE.md` summarising the deployment stack and the pyvisa-py choice.

## Out of scope for this work order

- Auto-updates from a server (manual installer drop is fine for now).
- Code-signing certificate procurement (note as a follow-up; the unsigned EXE will SmartScreen-warn but still installs).
- Multi-bench / centralised database (each bench PC keeps its own `atp.db`).
- Linux / macOS builds.

## Notes for the agent

1. The user is on Windows 11. The build machine and target machines are Windows. PyInstaller cross-compilation is not a thing — build on Windows, deploy on Windows.
2. Vendor binaries (`nssm.exe`, `VC_redist.x64.exe`) are large enough to make people grumble about repo size but small enough that committing them is the right call for an air-gapped customer. Add a `deploy/vendor/README.md` that documents the source URL and version of each.
3. If you discover the backend writes to paths other than `atp.db` (e.g. PDF certificates, audit log files), make sure the launcher's `os.chdir(APPDATA)` covers them too — otherwise upgrades will lose user data. Audit the `tps703-atp/backend/` source for `open(`, `Path(`, hardcoded relative paths.

## When you're done

Report back with:
1. The branch name and a one-line `git log --oneline` of your commits.
2. The path to the produced `TPS703-Setup-1.0.0.exe` and its size.
3. The smoke-test results (pyvisa-py against real instrument + clean-VM install).
4. Any open questions or surprises.
