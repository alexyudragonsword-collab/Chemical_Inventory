# Disable LAN mode: back to localhost-only + remove the firewall rule.

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot

$envFile = Join-Path $Root "config\chemtrack.env"
if (-not (Test-Path $envFile)) { throw "Not installed yet - run install.bat first." }

$fwCommand = "Remove-NetFirewallRule -DisplayName 'ChemTrack' -ErrorAction SilentlyContinue"
if (Test-IsAdmin) {
    Invoke-Expression $fwCommand
} else {
    Write-Host "A UAC prompt will appear to remove the firewall rule..."
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile", "-Command", $fwCommand
}

Set-EnvFileValue -Path $envFile -Key "HOSTNAME" -Value "127.0.0.1"

$appPid = Get-AliveManagedPid (Join-Path $Root "data\run\app.pid") $Root "server.js"
if ($appPid) {
    & (Join-Path $PSScriptRoot "stop.ps1")
    & (Join-Path $PSScriptRoot "start.ps1") -NoBrowser
}

Write-Host "LAN mode disabled - ChemTrack is reachable from this machine only." -ForegroundColor Green
