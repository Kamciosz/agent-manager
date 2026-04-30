@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "PS_SCRIPT=%ROOT_DIR%launcher\start.ps1"
set "NO_PAUSE=0"

if /I "%~1"=="--no-pause" set "NO_PAUSE=1"
if /I "%~2"=="--no-pause" set "NO_PAUSE=1"
if /I "%~3"=="--no-pause" set "NO_PAUSE=1"
if /I "%~4"=="--no-pause" set "NO_PAUSE=1"
if /I "%~5"=="--no-pause" set "NO_PAUSE=1"
if /I "%~6"=="--no-pause" set "NO_PAUSE=1"
if /I "%~7"=="--no-pause" set "NO_PAUSE=1"
if /I "%~8"=="--no-pause" set "NO_PAUSE=1"
if /I "%~9"=="--no-pause" set "NO_PAUSE=1"

echo.
echo ============================================================
echo   Agent Manager - LOCAL AI RUNTIME (Windows)
echo ============================================================
echo   start.bat is a small safety wrapper.
echo   Main launcher: start.ps1
echo ============================================================
echo.

if not exist "%PS_SCRIPT%" (
  echo [err] Missing PowerShell launcher: "%PS_SCRIPT%"
  set "EXIT_CODE=1"
  goto finish
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [err] powershell.exe was not found. Windows 10/11 should include it.
  set "EXIT_CODE=1"
  goto finish
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if not "%EXIT_CODE%"=="0" (
  echo [err] Launcher finished with exit code %EXIT_CODE%.
) else (
  echo [start] Launcher finished.
)

if "%NO_PAUSE%"=="0" (
  echo Press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%