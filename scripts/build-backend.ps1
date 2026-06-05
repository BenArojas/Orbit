# build-backend.ps1 — Build the PyInstaller sidecar on Windows.
#
# Outputs:
#   src-tauri\binaries\parallax-backend-x86_64-pc-windows-msvc.exe
#
# Requires the Orbit backend uv environment to be set up:
#   cd backend; uv sync
#
# Run from repo root:
#   pwsh scripts\build-backend.ps1

$ErrorActionPreference = "Stop"

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot "backend"
$BinDir     = Join-Path $RepoRoot "src-tauri\binaries"
$DistDir    = Join-Path $RepoRoot "dist-pyinstaller"
$BuildDir   = Join-Path $RepoRoot "build-pyinstaller"
$Triple     = "x86_64-pc-windows-msvc"

Write-Host "-> Building parallax-backend for $Triple"

if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }

Set-Location $BackendDir

if (Get-Command uv -ErrorAction SilentlyContinue) {
    uv run pyinstaller parallax-backend.spec `
        --distpath $DistDir `
        --workpath $BuildDir `
        --clean --noconfirm
} else {
    python -m PyInstaller parallax-backend.spec `
        --distpath $DistDir `
        --workpath $BuildDir `
        --clean --noconfirm
}

$Src = Join-Path $DistDir "parallax-backend.exe"
$Dst = Join-Path $BinDir  "parallax-backend-$Triple.exe"

Copy-Item -Path $Src -Destination $Dst -Force
Write-Host "OK  Built -> src-tauri\binaries\parallax-backend-$Triple.exe"
