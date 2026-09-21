@echo off
setlocal
cd /d "%~dp0"
if exist "update-portable.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-portable.ps1"
set "MATCHCUT_NODE=%~dp0runtime\node.exe"
if not exist "%MATCHCUT_NODE%" (
  echo Goi MatchCut nay bi thieu runtime. Hay tai lai ban one-click moi nhat.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Goi MatchCut nay bi thieu thu vien. Hay tai lai ban one-click moi nhat.
  pause
  exit /b 1
)
start "MatchCut Server" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:MATCHCUT_NVENC_PRESET='p1'; $env:MATCHCUT_NVENC_CQ='23'; Set-Location -LiteralPath '%~dp0'; & '%MATCHCUT_NODE%' server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:4173
endlocal
