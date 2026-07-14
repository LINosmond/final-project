@echo off
chcp 65001 >nul
cd /d "%~dp0"
title RO 物價追蹤

echo ============================================
echo   RO 物價追蹤 - 啟動中
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js。
  echo 請先到 https://nodejs.org 下載安裝 LTS 版，安裝後再點這個檔案。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 第一次啟動，安裝需要的東西（含瀏覽器，可能要幾分鐘）...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [錯誤] 安裝失敗，請把上面的訊息貼給我。
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo ============================================
  echo   已幫你建立 .env 設定檔
  echo   請用記事本打開資料夾裡的 .env，
  echo   填入你的 gnjoy 帳號與密碼，存檔後再重開這個檔案。
  echo ============================================
  echo.
  notepad ".env"
  pause
  exit /b 0
)

start "" http://localhost:5178
call npm start
pause
