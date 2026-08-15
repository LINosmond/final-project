@echo off
cd /d "%~dp0"
if exist ".git" (
  echo === Checking for updates (git pull) ===
  git pull
  echo.
)
call run.bat
pause
