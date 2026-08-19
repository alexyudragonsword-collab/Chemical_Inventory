# Register a user-level logon task that starts ChemTrack silently.
# No admin required (runs as the current user at logon).

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot

$vbs = Join-Path $Root "scripts\launch-hidden.vbs"
$action = 'wscript.exe "' + $vbs + '"'
schtasks /Create /F /SC ONLOGON /TN "ChemTrack" /TR $action | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to create the scheduled task." }
Write-Host "Autostart enabled: ChemTrack starts silently when you log on." -ForegroundColor Green
