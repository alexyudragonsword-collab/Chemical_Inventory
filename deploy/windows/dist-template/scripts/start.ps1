# Start ChemTrack: PostgreSQL + web app + background worker (hidden windows).

param([switch]$NoBrowser)

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot
Set-Location $Root

$envFile = Join-Path $Root "config\chemtrack.env"
if (-not (Test-Path $envFile)) { throw "Not installed yet - run install.bat first." }
$envTable = Set-ProcessEnvFromFile $envFile
$appPort = $envTable["PORT"]

$pgctl = Get-PgCtl $Root
$pgData = Join-Path $Root "data\pg"
$nodeExe = Get-NodeExe $Root
$runDir = Join-Path $Root "data\run"
$logDir = Join-Path $Root "data\logs"

# --- PostgreSQL ------------------------------------------------------------
if (Test-PgRunning $Root) {
    Write-Host "PostgreSQL: already running"
} else {
    Write-Host "PostgreSQL: starting..."
    & $pgctl -D $pgData -w -t 90 -l (Join-Path $logDir "pg.log") start
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start - see data\logs\pg.log" }
}

# --- Web app ---------------------------------------------------------------
$appPidFile = Join-Path $runDir "app.pid"
$alive = Get-AliveManagedPid $appPidFile $Root "server.js"
if ($alive) {
    Write-Host "App: already running (PID $alive)"
} else {
    Write-Host "App: starting on port $appPort..."
    $proc = Start-Process -FilePath $nodeExe -ArgumentList "server.js" `
        -WorkingDirectory (Join-Path $Root "app") -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir "app.log") `
        -RedirectStandardError (Join-Path $logDir "app.err.log")
    Set-Content -Path $appPidFile -Value $proc.Id -Encoding ASCII
}

# --- Worker ----------------------------------------------------------------
$workerPidFile = Join-Path $runDir "worker.pid"
$aliveWorker = Get-AliveManagedPid $workerPidFile $Root "worker.cjs"
if ($aliveWorker) {
    Write-Host "Worker: already running (PID $aliveWorker)"
} else {
    Write-Host "Worker: starting..."
    $proc = Start-Process -FilePath $nodeExe -ArgumentList "tools\worker.cjs" `
        -WorkingDirectory (Join-Path $Root "app") -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir "worker.log") `
        -RedirectStandardError (Join-Path $logDir "worker.err.log")
    Set-Content -Path $workerPidFile -Value $proc.Id -Encoding ASCII
}

# --- Wait for readiness ----------------------------------------------------
$url = "http://127.0.0.1:$appPort"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/sign-in" -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 1 }
}

if ($ready) {
    Write-Host ""
    Write-Host "ChemTrack is running: $url" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "$url" }
} else {
    Write-Warning "App did not answer within 60 s. Recent log:"
    Get-Content (Join-Path $logDir "app.err.log") -ErrorAction SilentlyContinue | Select-Object -Last 15
    exit 1
}
