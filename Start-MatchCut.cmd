@echo off
setlocal
cd /d "%~dp0"
if exist "update-portable.ps1" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-portable.ps1"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js chua duoc cai. Vui long cai Node.js 20+ tu https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-portable.ps1"
  if errorlevel 1 pause & exit /b 1
)
start "MatchCut Server" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:MATCHCUT_NVENC_PRESET='p1'; $env:MATCHCUT_NVENC_CQ='23'; Set-Location -LiteralPath '%~dp0'; node server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:4173
endlocal
