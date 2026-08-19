# Enable team/LAN mode: bind the app to 0.0.0.0 and open a Windows firewall
# rule (the firewall part self-elevates via UAC). The DATABASE always stays
# on 127.0.0.1 - only the web app is exposed.

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot

$envFile = Join-Path $Root "config\chemtrack.env"
if (-not (Test-Path $envFile)) { throw "Not installed yet - run install.bat first." }
$envTable = Read-EnvFile $envFile
$appPort = $envTable["PORT"]

Write-Host "Enabling LAN mode on port $appPort..."

# Firewall rule (needs admin; self-elevate just for this command).
$fwCommand = "New-NetFirewallRule -DisplayName 'ChemTrack' -Direction Inbound -Protocol TCP -LocalPort $appPort -Action Allow -Profile Domain,Private | Out-Null"
if (Test-IsAdmin) {
    Invoke-Expression $fwCommand
} else {
    Write-Host "A UAC prompt will appear for the firewall rule..."
    Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile", "-Command", $fwCommand
}

Set-EnvFileValue -Path $envFile -Key "HOSTNAME" -Value "0.0.0.0"

# Restart the app if it is running so the new binding takes effect.
$appPid = Get-AliveManagedPid (Join-Path $Root "data\run\app.pid") $Root "server.js"
if ($appPid) {
    Write-Host "Restarting ChemTrack to apply the new binding..."
    & (Join-Path $PSScriptRoot "stop.ps1")
    & (Join-Path $PSScriptRoot "start.ps1") -NoBrowser
}

Write-Host ""
Write-Host "LAN mode ENABLED. Team members on the same network can open:" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    ForEach-Object { Write-Host "  http://$($_.IPAddress):$appPort" }
Write-Host ""
Write-Host "Note: the firewall rule applies to Domain/Private networks only."
