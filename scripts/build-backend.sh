#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# build-backend.sh — Build the PyInstaller sidecar for the current platform.
#
# Outputs:
#   src-tauri/binaries/parallax-backend-<target-triple>       (macOS / Linux)
#   src-tauri/binaries/parallax-backend-<target-triple>.exe   (Windows/MSYS2)
#
# For a macOS universal build (arm64 + x86_64 lipo'd together), use:
#   bash scripts/build-backend.sh --universal
#
# Requires the Orbit backend uv environment to be set up:
#   cd backend && uv sync
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
BINARIES_DIR="$REPO_ROOT/src-tauri/binaries"
DIST_DIR="$REPO_ROOT/dist-pyinstaller"
BUILD_DIR="$REPO_ROOT/build-pyinstaller"

UNIVERSAL=false
if [[ "${1:-}" == "--universal" ]]; then
  UNIVERSAL=true
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

detect_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os/$arch" in
    Darwin/arm64)  echo "aarch64-apple-darwin"       ;;
    Darwin/x86_64) echo "x86_64-apple-darwin"        ;;
    Linux/x86_64)  echo "x86_64-unknown-linux-gnu"   ;;
    MINGW*/x86_64|MSYS*/x86_64|CYGWIN*/x86_64)
                   echo "x86_64-pc-windows-msvc"     ;;
    *)
      echo "Unsupported platform: $os/$arch" >&2 && exit 1 ;;
  esac
}

build_binary() {
  local arch_flag="${1:-}"  # e.g. "-x86_64" for Rosetta cross-compile, empty = native

  local run_prefix=""
  if [[ -n "$arch_flag" ]]; then
    run_prefix="arch $arch_flag"
  fi

  cd "$BACKEND_DIR"

  if command -v uv &>/dev/null; then
    $run_prefix uv run pyinstaller parallax-backend.spec \
      --distpath "$DIST_DIR${arch_flag}" \
      --workpath  "$BUILD_DIR${arch_flag}" \
      --clean --noconfirm
  else
    $run_prefix python3 -m PyInstaller parallax-backend.spec \
      --distpath "$DIST_DIR${arch_flag}" \
      --workpath  "$BUILD_DIR${arch_flag}" \
      --clean --noconfirm
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

mkdir -p "$BINARIES_DIR"

if $UNIVERSAL; then
  # ── Universal macOS: build arm64 + x86_64, then lipo ────────────────────
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Universal builds are macOS-only." >&2 && exit 1
  fi

  echo "→ Building native arm64 binary..."
  build_binary ""
  ARM_BIN="$DIST_DIR/parallax-backend"

  echo "→ Building x86_64 binary via Rosetta..."
  # Installs Rosetta if not present (silent, first-time only)
  softwareupdate --install-rosetta --agree-to-license 2>/dev/null || true
  build_binary "-x86_64"
  X86_BIN="$DIST_DIR-x86_64/parallax-backend"

  OUT="$BINARIES_DIR/parallax-backend-universal-apple-darwin"
  echo "→ Combining with lipo → $OUT"
  lipo -create -output "$OUT" "$ARM_BIN" "$X86_BIN"
  chmod +x "$OUT"
  echo "✓  Universal binary → src-tauri/binaries/parallax-backend-universal-apple-darwin"

else
  # ── Single-architecture build ────────────────────────────────────────────
  TRIPLE="$(detect_triple)"
  echo "→ Building parallax-backend for $TRIPLE..."

  build_binary ""

  SRC="$DIST_DIR/parallax-backend"
  DST="$BINARIES_DIR/parallax-backend-$TRIPLE"

  # Windows (MSYS2/Cygwin) produces an .exe
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    SRC="${SRC}.exe"
    DST="${DST}.exe"
  fi

  cp "$SRC" "$DST"
  chmod +x "$DST" 2>/dev/null || true
  echo "✓  Built → src-tauri/binaries/parallax-backend-$TRIPLE"
fi
