@echo off
setlocal
cd /d "%~dp0"
call "%~dp0start.bat" --update %*
echo.
echo Aktualizacja zakonczona albo pominieta bezpiecznie. Mozesz zamknac to okno.
pause
