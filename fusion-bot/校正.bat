@echo off
cd /d "%~dp0"
echo == Installing required packages (first run only) ==
python -m pip install -r requirements.txt
echo.
echo == Starting calibration ==
python calibrate.py
pause
