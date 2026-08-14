@echo off
cd /d "%~dp0"
echo ================================================
echo  Unblocking all files in this folder (remove MotW)...
echo ================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath (Get-Location) -Recurse -File -Force | Unblock-File"
echo.
echo Done. You can now double-click the other .bat files.
pause
