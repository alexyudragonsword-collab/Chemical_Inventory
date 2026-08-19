# Show ChemTrack component status.

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot

$envTable = Read-EnvFile (Join-Path $Root "config\chemtrack.env")
$appPort = $envTable["PORT"]
$pgPort = $envTable["PGPORT"]
$runDir = Join-Path $Root "data\run"

$pg = if (Test-PgRunning $Root) { "RUNNING (port $pgPort, localhost only)" } else { "stopped" }
$appPid = Get-AliveManagedPid (Join-Path $runDir "app.pid") $Root "server.js"
$app = if ($appPid) { "RUNNING (PID $appPid, port $appPort)" } else { "stopped" }
$workerPid = Get-AliveManagedPid (Join-Path $runDir "worker.pid") $Root "worker.cjs"
$worker = if ($workerPid) { "RUNNING (PID $workerPid)" } else { "stopped" }

$http = "unreachable"
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$appPort/sign-in" -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $http = "OK (http://localhost:$appPort)" }
} catch {}

Write-Host ""
Write-Host "ChemTrack status" -ForegroundColor Cyan
Write-Host "  PostgreSQL : $pg"
Write-Host "  Web app    : $app"
Write-Host "  Worker     : $worker"
Write-Host "  HTTP check : $http"
Write-Host "  LAN mode   : $(if ($envTable['HOSTNAME'] -eq '0.0.0.0') { 'ENABLED' } else { 'off (localhost only)' })"
