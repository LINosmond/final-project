@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "CONFIG=apps.txt"

echo ==========================================
echo    一鍵啟動器  One-Click Launcher
echo ==========================================
echo.

if not exist "%CONFIG%" (
    echo [錯誤] 找不到設定檔 %CONFIG%
    echo 請在同一個資料夾建立 apps.txt，一行寫一個要開的程式或網址。
    echo.
    pause
    exit /b 1
)

set "count=0"

rem eol=# 會跳過井字號開頭的註解行；空白行也會自動略過
for /f "usebackq eol=# tokens=* delims=" %%L in ("%CONFIG%") do call :launch "%%L"

echo.
echo ------------------------------------------
echo 完成，共啟動 %count% 個項目。
echo ------------------------------------------
timeout /t 3 >nul
exit /b 0

:launch
rem %~1 = 去掉引號後的整行內容
if "%~1"=="" goto :eof
set /a count+=1
echo [%count%] 啟動：%~1
start "" "%~1"
rem 每個項目之間停一下下，避免同時開太多卡住（要更快可把數字改小或刪掉這行）
timeout /t 1 >nul
goto :eof
