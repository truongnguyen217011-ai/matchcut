$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputRoot = if ($args[0]) { $args[0] } else { Join-Path $projectRoot "portable-output" }
$stage = Join-Path ([IO.Path]::GetTempPath()) ("matchcut-portable-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $outputRoot "MatchCut-portable.zip"
New-Item -ItemType Directory -Force -Path $stage, $outputRoot | Out-Null
try {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) { throw "Can chay npm ci truoc khi dong goi." }
  $nodeRuntimeVersion = "20.19.5"
  $nodeRuntimeRoot = Join-Path ([IO.Path]::GetTempPath()) "matchcut-node-$nodeRuntimeVersion"
  $nodeRuntimeExe = Join-Path $nodeRuntimeRoot "node-v$nodeRuntimeVersion-win-x64\node.exe"
  if (-not (Test-Path -LiteralPath $nodeRuntimeExe)) {
    $nodeRuntimeZip = Join-Path ([IO.Path]::GetTempPath()) "node-v$nodeRuntimeVersion-win-x64.zip"
    if (-not (Test-Path -LiteralPath $nodeRuntimeZip)) { Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeRuntimeVersion/node-v$nodeRuntimeVersion-win-x64.zip" -OutFile $nodeRuntimeZip -UseBasicParsing }
    New-Item -ItemType Directory -Force -Path $nodeRuntimeRoot | Out-Null
    Expand-Archive -LiteralPath $nodeRuntimeZip -DestinationPath $nodeRuntimeRoot -Force
  }
  $excluded = @(".git", ".cache-whisper", ".venv-whisper", "jobs", "releases", "portable-output", "test-exports", "test-exports-advanced", "test-exports-local", "qa-profile-assets", "data\runtime-jobs", "data\transcript-cache", "data\boundary-cache", "data\overlay-cache", "node_modules\@huggingface", "node_modules\onnxruntime-node", "node_modules\onnxruntime-web", "node_modules\onnxruntime-common", "node_modules\protobufjs", "node_modules\flatbuffers", "node_modules\@types", "node_modules\tar", "node_modules\minipass", "node_modules\minizlib", "node_modules\yallist", "node_modules\@isaacs", "node_modules\global-agent")
  Get-ChildItem -LiteralPath $projectRoot -Force -Recurse | Where-Object {
    $relative = $_.FullName.Substring($projectRoot.Length).TrimStart('\')
    -not ($excluded | Where-Object { $relative -eq $_ -or $relative.StartsWith($_ + '\') })
  } | ForEach-Object {
    $relative = $_.FullName.Substring($projectRoot.Length).TrimStart('\')
    $target = Join-Path $stage $relative
    if ($_.PSIsContainer) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
    else { New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $target }
  }
  $stagedModules = Join-Path $stage "node_modules"
  $bundledFfmpeg = Join-Path $projectRoot "node_modules\ffmpeg-static\ffmpeg.exe"
  $stagedFfmpeg = Join-Path $stagedModules "ffmpeg-static\ffmpeg.exe"
  Get-ChildItem -LiteralPath $stagedModules -Recurse -File -Include "*.map", "README*", "CHANGELOG*", "HISTORY*" -ErrorAction SilentlyContinue | Remove-Item -Force
  if (-not (Test-Path -LiteralPath $stagedFfmpeg)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $stagedFfmpeg) | Out-Null
    Copy-Item -LiteralPath $bundledFfmpeg -Destination $stagedFfmpeg -Force
  }
  $runtime = Join-Path $stage "runtime"
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  Copy-Item -LiteralPath $nodeRuntimeExe -Destination (Join-Path $runtime "node.exe") -Force
  $nodeLicense = Join-Path (Split-Path $nodeRuntimeExe) "LICENSE"
  if (Test-Path -LiteralPath $nodeLicense) { Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtime "NODE-LICENSE.txt") -Force }
  if (-not (Test-Path -LiteralPath $stagedFfmpeg)) { throw "Goi thieu FFmpeg runtime." }
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  Write-Host "Da tao ban one-click tu chua Node, dependencies va FFmpeg: $zip" -ForegroundColor Green
} finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
