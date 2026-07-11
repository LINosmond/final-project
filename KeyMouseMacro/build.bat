@echo off
REM ============================================================
REM  按鍵精靈 KeyMouseMacro 一鍵建置腳本 (Windows)
REM  在本檔案所在資料夾按兩下，或在命令列執行： build.bat
REM  完成後執行檔會出現在  dist\KeyMouseMacro.exe
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo [1/3] 安裝相依套件 (pynput, pyinstaller)...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto error

echo.
echo [2/3] 用 PyInstaller 打包...
python -m PyInstaller --noconfirm KeyMouseMacro.spec
if errorlevel 1 goto error

echo.
echo [3/3] 完成！
echo 執行檔位置： %cd%\dist\KeyMouseMacro.exe
echo.
pause
exit /b 0

:error
echo.
echo *** 建置失敗，請看上方錯誤訊息。確認已安裝 Python 3 並加入 PATH。 ***
echo.
pause
exit /b 1
