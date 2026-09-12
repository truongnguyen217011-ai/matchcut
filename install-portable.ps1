$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Chua cai Node.js 20+; cai tu https://nodejs.org/ roi chay lai." }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Chua cai Python 3.10+; cai tu https://www.python.org/ roi chay lai." }

Write-Host "Cai Node dependencies..." -ForegroundColor Cyan
npm ci

Write-Host "Cai Faster-Whisper/CUDA runtime..." -ForegroundColor Cyan
& (Join-Path $projectRoot "install-faster-whisper.ps1")

New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot "data"), (Join-Path $projectRoot "jobs") | Out-Null
Write-Host "Cai dat xong. Chay .\start-portable.ps1 de mo tool." -ForegroundColor Green
