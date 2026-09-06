@echo off
cd /d "%~dp0"
title RO Price Tracker

echo ============================================
echo   RO Price Tracker - starting up
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Please install the LTS version from https://nodejs.org
  echo then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run: installing dependencies. This includes a browser
  echo and may take a few minutes. Lots of text is normal.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] Install failed. Please send me the messages above.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
)

echo.
echo When the page opens, click the yellow "login gnjoy" button once
echo to log in. After that it tracks prices automatically.
echo Starting... your browser will open at http://localhost:5178
start "" http://localhost:5178
call npm start
pause
