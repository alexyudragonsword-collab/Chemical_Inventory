# ChemTrack one-click installer for Windows 10/11.
# Creates the local PostgreSQL cluster, restores the bundled snapshot,
# writes config\chemtrack.env and desktop shortcuts. No admin required.
#
# Re-running is safe: an existing installation (data\pg) is preserved.
# Use install.bat --reset to wipe data and start over (asks for confirmation).

param([switch]$Reset)

. (Join-Path $PSScriptRoot "lib.ps1")
$Root = Get-ChemRoot
Set-Location $Root

Write-Host ""
Write-Host "=== ChemTrack installer ===" -ForegroundColor Cyan
Write-Host "Install location: $Root"

# --- 0. Unblock mark-of-the-web (best effort) ------------------------------
try { Get-ChildItem -Path $Root -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch {}

# --- 1. Guard rails --------------------------------------------------------
if ($Root.Length -gt 60) {
    Write-Warning "Install path is long ($($Root.Length) chars). Prefer a short path like C:\ChemTrack to avoid Windows path-length issues."
}
if ($Root -match '[!]' -or $Root -match '[^\u0000-\u007F]') {
    Write-Warning "Install path contains special or non-ASCII characters. If anything fails, move the folder to C:\ChemTrack and re-run."
}

$nodeExe = Get-NodeExe $Root
$nodeVersion = & $nodeExe -v
if ($LASTEXITCODE -ne 0) { throw "Bundled Node runtime failed to start ($nodeExe)" }
Write-Host "Node runtime: $nodeVersion"

$pgctl = Get-PgCtl $Root
$dataDir = Join-Path $Root "data"
$pgData = Join-Path $dataDir "pg"
$envFile = Join-Path $Root "config\chemtrack.env"

# --- 2. Reset / idempotence ------------------------------------------------
if ($Reset -and (Test-Path $pgData)) {
    Write-Host ""
    Write-Warning "--reset will DELETE the entire data folder (database + uploaded files)."
    $confirm = Read-Host "Type DELETE to confirm"
    if ($confirm -ne "DELETE") { Write-Host "Aborted."; exit 1 }
    if (Test-PgRunning $Root) { & $pgctl -D $pgData -m fast -w stop }
    Remove-Item -Recurse -Force $dataDir
}

$freshInstall = -not (Test-Path (Join-Path $pgData "PG_VERSION"))
foreach ($dir in @("data", "data\logs", "data\run", "data\files")) {
    $p = Join-Path $Root $dir
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

if (-not $freshInstall) {
    Write-Host ""
    Write-Host "Existing installation detected - keeping your data." -ForegroundColor Yellow
    if (-not (Test-Path $envFile)) {
        throw "data\pg exists but config\chemtrack.env is missing. Restore the config from backup or re-install with --reset."
    }
} else {
    # --- 3. Pick ports -----------------------------------------------------
    $pgPort = Find-FreePort 5433
    $appPort = Find-FreePort 3000
    Write-Host "Ports: application $appPort, database $pgPort (localhost only)"

    # --- 4. Secrets --------------------------------------------------------
    $superPassword = New-RandomAlnum 24
    $ownerPassword = New-RandomAlnum 24
    $appPassword = New-RandomAlnum 24
    $authSecret = New-RandomSecret
    $pwFile = Join-Path $dataDir "pg-super.pwfile"
    Set-Content -Path $pwFile -Value $superPassword -Encoding ASCII

    # --- 5. initdb ---------------------------------------------------------
    Write-Host ""
    Write-Host "Creating database cluster..."
    $initLog = Join-Path $dataDir "logs\pg-initdb.log"
    & $pgctl initdb -D $pgData -o "-U chemtrack_super -E UTF8 --locale=C -A scram-sha-256 --pwfile=`"$pwFile`"" *> $initLog
    if ($LASTEXITCODE -ne 0) { Get-Content $initLog | Select-Object -Last 20; throw "initdb failed - see $initLog" }

    Add-Content -Path (Join-Path $pgData "postgresql.conf") -Value @(
        "",
        "# --- ChemTrack installer settings ---",
        "port = $pgPort",
        "listen_addresses = '127.0.0.1'"
    )

    # --- 6. Start PG + restore snapshot ------------------------------------
    Write-Host "Restoring database snapshot (seed data + imported legacy inventory)..."
    $pgLog = Join-Path $dataDir "logs\pg.log"
    & $pgctl -D $pgData -w -t 90 -l $pgLog start
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start - see $pgLog" }

    try {
        $restoreOut = & $nodeExe (Join-Path $Root "app\tools\restore-db.cjs") `
            --pgport $pgPort --superuser chemtrack_super --pwfile $pwFile `
            --dump (Join-Path $Root "db\snapshot.sql.gz") `
            --owner-password $ownerPassword --app-password $appPassword 2>&1
        $restoreText = ($restoreOut | Out-String).Trim()
        Write-Host "Restore result: $restoreText"
        if ($LASTEXITCODE -ne 0 -or $restoreText -notlike '*"ok":true*') {
            throw "Snapshot restore failed."
        }
    } finally {
        & $pgctl -D $pgData -m fast -w stop | Out-Null
    }

    # --- 7. Write config ---------------------------------------------------
    $template = Get-Content (Join-Path $Root "config\chemtrack.env.template") -Raw
    $filesDir = Join-Path $Root "data\files"
    $rendered = $template `
        -replace "{{DATABASE_URL}}", "postgresql://chemtrack_app:$appPassword@127.0.0.1:$pgPort/chemtrack" `
        -replace "{{MIGRATE_DATABASE_URL}}", "postgresql://chemtrack_owner:$ownerPassword@127.0.0.1:$pgPort/chemtrack" `
        -replace "{{AUTH_SECRET}}", $authSecret `
        -replace "{{PORT}}", "$appPort" `
        -replace "{{PGPORT}}", "$pgPort" `
        -replace "{{FILE_STORAGE_ROOT}}", $filesDir
    Set-Content -Path $envFile -Value $rendered -Encoding ASCII
}

# --- 8. Shortcuts ----------------------------------------------------------
$envTable = Read-EnvFile $envFile
$appPortFinal = $envTable["PORT"]

# Flavor suffix (e.g. -demo) taken from the install folder name, so shortcuts
# from different flavors installed side by side don't overwrite each other.
$rootLeaf = Split-Path $Root -Leaf
$flavor = ""
if ($rootLeaf -match "(?i)win64[-_](.+)$") { $flavor = "-$($Matches[1])" }
elseif ($rootLeaf -match "(?i)demo") { $flavor = "-demo" }

try {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")

    $lnk = $shell.CreateShortcut((Join-Path $desktop "ChemTrack$flavor - Start.lnk"))
    $lnk.TargetPath = Join-Path $Root "start.bat"
    $lnk.WorkingDirectory = $Root
    $lnk.Save()

    $lnk = $shell.CreateShortcut((Join-Path $desktop "ChemTrack$flavor - Stop.lnk"))
    $lnk.TargetPath = Join-Path $Root "stop.bat"
    $lnk.WorkingDirectory = $Root
    $lnk.Save()

    $url = $shell.CreateShortcut((Join-Path $desktop "ChemTrack$flavor.url"))
    $url.TargetPath = "http://localhost:$appPortFinal"
    $url.Save()
    Write-Host "Desktop shortcuts created."
} catch {
    Write-Warning "Could not create desktop shortcuts: $_"
}

# --- 9. Summary ------------------------------------------------------------
Write-Host ""
Write-Host "=== Installation complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Start ChemTrack:  double-click start.bat (or the desktop shortcut)"
Write-Host "Open in browser:  http://localhost:$appPortFinal"
Write-Host ""
Write-Host "Demo accounts (password: chemtrack-demo) - CHANGE AFTER FIRST LOGIN:"
Write-Host "  admin@lab.internal      (Admin)"
Write-Host "  li.wei@lab.internal     (Lab Manager, B2-14)"
Write-Host "  m.tan@lab.internal      (Custodian)"
Write-Host "  ehs@lab.internal        (EHS Officer)"
Write-Host ""
Write-Host "Backup: run stop.bat, then copy this whole folder."
Write-Host "Team/LAN mode: run enable-lan.bat (see README-WINDOWS.md)."
