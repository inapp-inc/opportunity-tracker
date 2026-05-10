@echo off
setlocal ENABLEDELAYEDEXPANSION

cd /d "%~dp0"

where.exe powershell.exe >nul 2>&1
if errorlevel 1 (
    echo PowerShell ^(powershell.exe^) was not found on PATH.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-OpportunityTracker.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
echo Launcher finished with exit code %EXITCODE%.
pause
exit /b %EXITCODE%
