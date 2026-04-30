@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"

if not exist "%~dp0launcher\update.ps1" (
	echo [err] Missing launcher\update.ps1 next to Aktualizuj.bat.
	set "EXIT_CODE=1"
	goto finish
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
	echo [err] powershell.exe was not found. Windows 10/11 should include it.
	set "EXIT_CODE=1"
	goto finish
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\update.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
if "%EXIT_CODE%"=="0" (
	echo Aktualizacja zakonczona albo pominieta bezpiecznie. Uruchom start.bat ponownie, jesli byl otwarty wczesniej.
) else (
	echo Aktualizacja nie powiodla sie ^(kod %EXIT_CODE%^). Sprawdz komunikaty powyzej.
)
pause
exit /b %EXIT_CODE%
