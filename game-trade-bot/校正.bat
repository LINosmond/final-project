@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 第一次使用：安裝需要的套件 ===
pip install -r requirements.txt
echo.
echo === 開始校正 ===
python calibrate.py
pause
