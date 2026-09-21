$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot
$node = Join-Path $projectRoot "runtime\node.exe"
if (-not (Test-Path -LiteralPath $node)) { throw "Goi MatchCut thieu runtime; hay tai lai ban one-click moi nhat." }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) { throw "Goi MatchCut thieu thu vien; hay tai lai ban one-click moi nhat." }
$env:MATCHCUT_NVENC_PRESET = if ($env:MATCHCUT_NVENC_PRESET) { $env:MATCHCUT_NVENC_PRESET } else { "p1" }
$env:MATCHCUT_NVENC_CQ = if ($env:MATCHCUT_NVENC_CQ) { $env:MATCHCUT_NVENC_CQ } else { "23" }
Write-Host "MatchCut dang chay tai http://localhost:4173 (NVENC $($env:MATCHCUT_NVENC_PRESET), CQ $($env:MATCHCUT_NVENC_CQ))" -ForegroundColor Green
& $node server.js
