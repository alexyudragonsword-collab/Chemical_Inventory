# Run a bundled maintenance tool with the ChemTrack environment loaded.
#   run-tool.bat verify-audit
#   run-tool.bat import-legacy --file C:\path\to\export.xlsx --dry-run

param(
    [Parameter(Mandatory = $true)][string]$Tool,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

. (Join-Path (Split-Path -Parent $PSScriptRoot) "setup\lib.ps1")
$Root = Get-ChemRoot

$toolFile = Join-Path $Root "app\tools\$Tool.cjs"
if (-not (Test-Path $toolFile)) {
    $available = (Get-ChildItem (Join-Path $Root "app\tools") -Filter "*.cjs" | ForEach-Object { $_.BaseName }) -join ", "
    throw "Unknown tool '$Tool'. Available: $available"
}

$envFile = Join-Path $Root "config\chemtrack.env"
if (-not (Test-Path $envFile)) { throw "Not installed yet - run install.bat first." }
$envTable = Set-ProcessEnvFromFile $envFile

# Maintenance tools (import) write through the owner role.
if ($Tool -eq "import-legacy" -and $envTable.ContainsKey("MIGRATE_DATABASE_URL")) {
    $env:DATABASE_URL = $envTable["MIGRATE_DATABASE_URL"]
}

if (-not (Test-PgRunning $Root)) {
    Write-Host "Starting PostgreSQL for the tool run..."
    & (Get-PgCtl $Root) -D (Join-Path $Root "data\pg") -w -t 90 -l (Join-Path $Root "data\logs\pg.log") start | Out-Null
}

& (Get-NodeExe $Root) $toolFile @Rest
exit $LASTEXITCODE
