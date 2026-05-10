@echo off
setlocal
cd /d "%~dp0"

if "%API_PORT%"=="" set "API_PORT=3001"

if not exist "node_modules\concurrently" goto deps
if not exist "server\node_modules\express" goto deps
if not exist "web\node_modules\vite" goto deps
goto start

:deps
echo Installing dependencies...
call npm install --no-fund --no-audit
call npm run install:all

:start
echo API: http://localhost:%API_PORT%   Web: http://localhost:5173
echo Press Ctrl+C to stop both.
call npm run dev
