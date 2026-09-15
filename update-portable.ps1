$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestUrl = "https://raw.githubusercontent.com/truongnguyen217011-ai/matchcut/main/update-manifest.json"
$localManifest = Get-Content (Join-Path $projectRoot "update-manifest.json") -Raw | ConvertFrom-Json
try { $remote = Invoke-RestMethod -Uri $manifestUrl -TimeoutSec 10 } catch { return }
if ([version]$remote.version -le [version]$localManifest.version) { return }
$answer = Read-Host "Co ban MatchCut moi $($remote.version). Tai va cap nhat ngay? (Y/N)"
if ($answer -notmatch '^(y|yes|c|co)$') { return }
$tempRoot = Join-Path $env:TEMP ("matchcut-update-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $tempRoot "update.zip"
$extract = Join-Path $tempRoot "extract"
try {
  New-Item -ItemType Directory -Force -Path $tempRoot, $extract | Out-Null
  Invoke-WebRequest -Uri $remote.packageUrl -OutFile $zip -UseBasicParsing
  if ($remote.sha256) {
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $remote.sha256.ToLowerInvariant()) { throw "Sai checksum goi cap nhat." }
  }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $source = (Get-ChildItem -LiteralPath $extract -Force | Select-Object -First 1).FullName
  if (-not $source) { throw "Goi cap nhat rong." }
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    if ($_.Name -notin @("data", "jobs", "node_modules", ".venv-whisper")) {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $projectRoot $_.Name) -Recurse -Force
    }
  }
  $remote | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $projectRoot "update-manifest.json") -Encoding UTF8
  Write-Host "Da cap nhat MatchCut len $($remote.version)." -ForegroundColor Green
} catch { Write-Warning "Khong cap nhat duoc: $($_.Exception.Message)" }
finally { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
