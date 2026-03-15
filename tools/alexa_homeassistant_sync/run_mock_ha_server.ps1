$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent (Split-Path -Parent $scriptDir)
$logDir = Join-Path $rootDir "config\\alexa_sync"
$logFile = Join-Path $logDir "mock-ha-server.log"
$launcherLog = Join-Path $logDir "mock-ha-launcher.log"
$pythonCommand = (& python -c "import sys; print(sys.executable)").Trim()
if (-not (Test-Path $pythonCommand)) {
	throw "Unable to resolve Python executable path"
}
$serverScript = Join-Path $scriptDir "mock_ha_todo_server.py"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$existing = Get-CimInstance Win32_Process | Where-Object {
	$_.Name -eq "python.exe" -and $_.CommandLine -like "*tools\\alexa_homeassistant_sync\\mock_ha_todo_server.py*"
}

if ($existing) {
	Add-Content -Path $launcherLog -Value "$(Get-Date -Format o) mock HA server already running"
	return
}

$command = "cd /d `"$rootDir`" && `"$pythonCommand`" `"$serverScript`" >> `"$logFile`" 2>>&1"
$process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $command -WindowStyle Hidden -PassThru

Add-Content -Path $launcherLog -Value "$(Get-Date -Format o) started mock HA server pid=$($process.Id)"
