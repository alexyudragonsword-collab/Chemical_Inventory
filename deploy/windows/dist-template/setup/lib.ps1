# Shared helpers for the ChemTrack Windows bundle (PowerShell 5.1 compatible).

$ErrorActionPreference = "Stop"

function Get-ChemRoot {
    # lib.ps1 lives in <root>\setup or is dot-sourced from <root>\scripts.
    return (Split-Path -Parent $PSScriptRoot)
}

function Read-EnvFile {
    param([string]$Path)
    $table = @{}
    if (-not (Test-Path $Path)) { return $table }
    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -lt 1) { continue }
        $key = $trimmed.Substring(0, $idx).Trim()
        $value = $trimmed.Substring($idx + 1).Trim()
        $table[$key] = $value
    }
    return $table
}

function Set-ProcessEnvFromFile {
    param([string]$Path)
    $table = Read-EnvFile $Path
    foreach ($key in $table.Keys) {
        [System.Environment]::SetEnvironmentVariable($key, $table[$key], "Process")
    }
    return $table
}

function Test-PortFree {
    param([int]$Port)
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Find-FreePort {
    param([int]$Start, [int]$Count = 10)
    for ($p = $Start; $p -lt $Start + $Count; $p++) {
        if (Test-PortFree $p) { return $p }
    }
    throw "No free port in range $Start..$($Start + $Count - 1)"
}

function New-RandomAlnum {
    param([int]$Length = 24)
    $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $result = ""
    foreach ($b in $bytes) { $result += $chars[$b % $chars.Length] }
    return $result
}

function New-RandomSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Get-PgCtl {
    param([string]$Root)
    return (Join-Path $Root "pgsql\bin\pg_ctl.exe")
}

function Get-NodeExe {
    param([string]$Root)
    return (Join-Path $Root "runtime\node\node.exe")
}

function Test-PgRunning {
    param([string]$Root)
    $pgctl = Get-PgCtl $Root
    $dataDir = Join-Path $Root "data\pg"
    & $pgctl -D $dataDir status *> $null
    return ($LASTEXITCODE -eq 0)
}

function Get-AliveManagedPid {
    # Returns the PID from a pid file only when that PID is still OUR node.exe
    # running the expected script (guards against PID reuse).
    param([string]$PidFile, [string]$Root, [string]$CommandLineMatch)
    if (-not (Test-Path $PidFile)) { return $null }
    $procId = (Get-Content $PidFile | Select-Object -First 1).Trim()
    if (-not ($procId -match '^\d+$')) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) { return $null }
    $nodeExe = Get-NodeExe $Root
    if ($proc.ExecutablePath -ne $nodeExe) { return $null }
    if ($proc.CommandLine -notlike "*$CommandLineMatch*") { return $null }
    return [int]$procId
}

function Set-EnvFileValue {
    param([string]$Path, [string]$Key, [string]$Value)
    $lines = @(Get-Content $Path)
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^$Key=") {
            $lines[$i] = "$Key=$Value"
            $found = $true
        }
    }
    if (-not $found) { $lines += "$Key=$Value" }
    Set-Content -Path $Path -Value $lines -Encoding ASCII
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
