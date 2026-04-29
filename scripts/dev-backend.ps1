# Parallax dev-mode backend launcher (Windows / PowerShell).
#
# Why this exists:
#   `uvicorn --reload` doesn't always propagate shutdown signals to the worker,
#   and Ctrl+C / closing the terminal can leave the IBKR Gateway JVM as an
#   orphan on port 5001. The next dev launch then hits "port already in use"
#   until you Factory Reset the Gateway.
#
#   This wrapper:
#     1. Registers a Ctrl+C handler that kills the JVM listed in
#        ~/.parallax/gateway/gateway.pid (and its children) via taskkill /T /F.
#     2. Otherwise runs `uv run uvicorn ...` directly.
#
# Usage:
#   pwsh ./scripts/dev-backend.ps1
# Equivalent to the old:
#   cd backend; uv run uvicorn main:app --reload --port 8000

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$PidFile  = Join-Path $env:USERPROFILE '.parallax\gateway\gateway.pid'

function Stop-GatewayFromPidFile {
    if (-not (Test-Path $PidFile)) { return }

    $content = Get-Content $PidFile -ErrorAction SilentlyContinue
    if (-not $content) { return }

    $pidLine = $content | Where-Object { $_ -match '^pid=' } | Select-Object -First 1
    if (-not $pidLine) { return }

    $gatewayPid = [int]($pidLine -replace '^pid=', '').Trim()
    if (-not $gatewayPid) { return }

    # Already gone? Just tidy up.
    $proc = Get-Process -Id $gatewayPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Remove-Item -Path $PidFile -ErrorAction SilentlyContinue
        return
    }

    Write-Host "[dev-backend] Killing Gateway process tree (pid=$gatewayPid)..."
    # /T = kill child processes, /F = force.
    & taskkill.exe /T /F /PID $gatewayPid 2>&1 | Out-Null
    Remove-Item -Path $PidFile -ErrorAction SilentlyContinue
}

# Ctrl+C handler — PowerShell exposes this via [Console]::CancelKeyPress.
$cancelHandler = {
    param($sender, $eventArgs)
    Write-Host "[dev-backend] caught Ctrl+C — shutting down"
    Stop-GatewayFromPidFile
    $eventArgs.Cancel = $false   # let the process actually exit
}
[Console]::TreatControlCAsInput = $false
$null = Register-ObjectEvent -InputObject ([Console]) -EventName CancelKeyPress -Action $cancelHandler

try {
    Set-Location (Join-Path $RepoRoot 'backend')
    & uv run uvicorn main:app --reload --port 8000
} finally {
    Stop-GatewayFromPidFile
}
