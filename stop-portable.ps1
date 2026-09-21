$ErrorActionPreference = "SilentlyContinue"
$listeners = @(Get-NetTCPConnection -LocalPort 4173 -State Listen)
foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($process -and ($process.CommandLine -match "server\.js" -or $process.CommandLine -match "MatchCut")) {
    Stop-Process -Id $listener.OwningProcess -Force
    Write-Host "Da dung backend MatchCut cu de nap ban moi." -ForegroundColor DarkGray
  }
}
