$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $rootDir "config\\alexa_sync"
$logFile = Join-Path $logDir "sync-runtime.log"
$launcherLog = Join-Path $logDir "launcher.log"
$pythonCommand = (& python -c "import sys; print(sys.executable)").Trim()
if (-not (Test-Path $pythonCommand)) {
	throw "Unable to resolve Python executable path"
}
$syncScript = Join-Path $scriptDir "sync_loop.py"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$existing = Get-CimInstance Win32_Process | Where-Object {
	$_.Name -eq "python.exe" -and $_.CommandLine -like "*tools\\alexa_homeassistant_sync\\sync_loop.py*"
}

if ($existing) {
	Add-Content -Path $launcherLog -Value "$(Get-Date -Format o) sync loop already running"
	return
}

$command = "cd /d `"$rootDir`" && `"$pythonCommand`" `"$syncScript`" --interval 60 >> `"$logFile`" 2>>&1"
$process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -WindowStyle Hidden -PassThru

Add-Content -Path $launcherLog -Value "$(Get-Date -Format o) started Alexa sync loop pid=$($process.Id)"
