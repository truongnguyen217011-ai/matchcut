$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $projectRoot ".venv-whisper\Scripts\python.exe"

Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath $venvPython)) {
  python -m venv .venv-whisper
}
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install faster-whisper==1.2.1
& $venvPython -c "from faster_whisper import WhisperModel; print('Faster-Whisper da san sang.')"

