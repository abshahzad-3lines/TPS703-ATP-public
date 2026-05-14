@echo off
title TPS-703 ATP System Launcher
echo.
echo   ============================================
echo    TPS-703 ATP Automation System
echo    Acceptance Test Procedure - CAGE 97942
echo    Phases 1-8 Complete
echo   ============================================
echo.

:: Kill any existing processes on ports 8005 and 5173
echo [1/6] Stopping existing servers...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8005 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Install backend dependencies
echo [2/6] Checking backend dependencies...
cd /d "%~dp0tps703-atp\backend"
call venv\Scripts\activate && pip install -q -r requirements.txt 2>nul

:: Install frontend dependencies
echo [3/6] Checking frontend dependencies...
cd /d "%~dp0tps703-atp\frontend"
call npm install --silent 2>nul

:: Start backend
echo [4/6] Starting backend server on port 8005...
cd /d "%~dp0tps703-atp\backend"
start "ATP Backend" cmd /k "call venv\Scripts\activate && uvicorn main:app --reload --port 8005"

:: Start frontend
echo [5/6] Starting frontend dev server on port 5173...
cd /d "%~dp0tps703-atp\frontend"
start "ATP Frontend" cmd /k "npm run dev -- --port 5173"

:: Wait for servers to be ready
echo [6/6] Waiting for servers to start...
timeout /t 8 /nobreak >nul

:: Open browser
echo Opening browser...
start http://localhost:5173

echo.
echo   ============================================
echo    Servers Running
echo   ============================================
echo.
echo   Backend:  http://localhost:8005
echo   Frontend: http://localhost:5173
echo   API Docs: http://localhost:8005/docs
echo.
echo   Default login:  admin / admin123
echo.
echo   Pages:
echo     /dashboard          - Subsystem overview
echo     /test-setup         - Configure new test
echo     /test-execution     - Run tests (Manual/Auto)
echo     /results            - View completed tests
echo     /equipment          - Manage instruments
echo     /instrument-bench   - Live readout, control, diagnostics
echo     /admin              - Audit trail
echo.
echo   Close the "ATP Backend" and "ATP Frontend"
echo   windows to stop the servers.
echo.
pause
