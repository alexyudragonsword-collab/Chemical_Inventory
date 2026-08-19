# Remove the ChemTrack logon task.

schtasks /Delete /F /TN "ChemTrack" 2>$null | Out-Null
Write-Host "Autostart disabled." -ForegroundColor Green
