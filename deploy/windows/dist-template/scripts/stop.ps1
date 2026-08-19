# Stop ChemTrack: worker + web app + PostgreSQL.

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot
Set-Location $Root

$runDir = Join-Path $Root "data\run"

foreach ($item in @(
    @{ Name = "Worker"; File = (Join-Path $runDir "worker.pid"); Match = "worker.cjs" },
    @{ Name = "App"; File = (Join-Path $runDir "app.pid"); Match = "server.js" }
)) {
    $procId = Get-AliveManagedPid $item.File $Root $item.Match
    if ($procId) {
        Write-Host "$($item.Name): stopping (PID $procId)"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "$($item.Name): not running"
    }
    Remove-Item $item.File -ErrorAction SilentlyContinue
}

if (Test-PgRunning $Root) {
    Write-Host "PostgreSQL: stopping"
    & (Get-PgCtl $Root) -D (Join-Path $Root "data\pg") -m fast -w stop
} else {
    Write-Host "PostgreSQL: not running"
}

Write-Host "ChemTrack stopped." -ForegroundColor Green
