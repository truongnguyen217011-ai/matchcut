$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputRoot = if ($args[0]) { $args[0] } else { Join-Path $projectRoot "portable-output" }
$stage = Join-Path ([IO.Path]::GetTempPath()) ("matchcut-portable-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $outputRoot "MatchCut-portable.zip"
New-Item -ItemType Directory -Force -Path $stage, $outputRoot | Out-Null
try {
  $excluded = @(".git", ".cache-whisper", ".venv-whisper", "node_modules", "jobs", "test-exports", "test-exports-advanced", "test-exports-local", "qa-profile-assets", "data\runtime-jobs", "data\transcript-cache", "data\boundary-cache", "data\overlay-cache")
  Get-ChildItem -LiteralPath $projectRoot -Force -Recurse | Where-Object {
    $relative = $_.FullName.Substring($projectRoot.Length).TrimStart('\')
    -not ($excluded | Where-Object { $relative -eq $_ -or $relative.StartsWith($_ + '\') })
  } | ForEach-Object {
    $relative = $_.FullName.Substring($projectRoot.Length).TrimStart('\')
    $target = Join-Path $stage $relative
    if ($_.PSIsContainer) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
    else { New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $target }
  }
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  Write-Host "Da tao $zip" -ForegroundColor Green
} finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
