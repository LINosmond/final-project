@echo off
cd /d "%~dp0"
echo === Checking for updates (git pull) ===
git pull
echo.
call run.bat
pause
