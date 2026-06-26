# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec — Orbit backend sidecar.

Build via the helper script (recommended):
    bash scripts/build-backend.sh          # macOS / Linux
    pwsh scripts/build-backend.ps1         # Windows

Or directly from the backend/ directory:
    pyinstaller parallax-backend.spec --distpath ../dist-pyinstaller --clean
"""

from PyInstaller.utils.hooks import collect_all

block_cipher = None

# pandas-ta loads its ~200 indicators dynamically at import time.
pandas_ta_datas, pandas_ta_binaries, pandas_ta_hiddenimports = collect_all("pandas_ta")

# pandas optional extensions / data files
pandas_datas, pandas_binaries, pandas_hiddenimports = collect_all("pandas")

# FastMCP (read-only MCP server) resolves its streamable-http transport and its
# OpenAPI/route parsing dynamically, so collect each package whole — a missing
# submodule surfaces only as ModuleNotFoundError in the packaged sidecar.
mcp_datas, mcp_binaries, mcp_hiddenimports = [], [], []
for _mcp_pkg in ("fastmcp", "mcp", "sse_starlette", "openapi_pydantic",
                 "jsonschema_path", "pydantic_settings"):
    _d, _b, _h = collect_all(_mcp_pkg)
    mcp_datas += _d
    mcp_binaries += _b
    mcp_hiddenimports += _h

a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=[
        *pandas_ta_binaries,
        *pandas_binaries,
        *mcp_binaries,
    ],
    datas=[
        *pandas_ta_datas,
        *pandas_datas,
        *mcp_datas,
    ],
    hiddenimports=[
        # ── Uvicorn (most submodules resolved via string at runtime) ──────
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # ── Application modules ───────────────────────────────────────────
        "main",
        "mcp_server",
        "config",
        "constants",
        "state",
        "deps",
        "exceptions",
        "cache",
        "rate_control",
        "models",
        "routers.ai",
        "routers.auth",
        "routers.fibonacci",
        "routers.gateway",
        "routers.health",
        "routers.indicators",
        "routers.market",
        "routers.screener",
        "routers.sectors",
        "routers.settings",
        "routers.triggers",
        "routers.watchlist",
        "routers.watchlist_config",
        "routers.ws",
        "services.ai",
        "services.db",
        "services.gateway",
        "services.ibkr",
        "services.indicators",
        "services.ollama",
        "services.prompt_builder",
        "services.scanner",
        "services.screener",
        "services.screener_ai",
        "services.sectors",
        # ── Third-party ───────────────────────────────────────────────────
        *pandas_ta_hiddenimports,
        *pandas_hiddenimports,
        "polars",
        "polars._utils",
        "aiolimiter",
        "websockets",
        "websockets.legacy",
        "websockets.legacy.server",
        "websockets.legacy.client",
        "websockets.asyncio",
        "websockets.asyncio.server",
        "websockets.asyncio.client",
        "httpx",
        "pydantic",
        "pydantic_core",
        "sqlite3",
        "h11",
        "anyio",
        "anyio._backends._asyncio",
        "starlette",
        "starlette.middleware.cors",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "scipy",
        "IPython",
        "notebook",
        "pytest",
        "pytest_asyncio",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="parallax-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX disabled — compressed executables trigger antivirus false positives on Windows.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    # console=False suppresses the terminal window on Windows in release builds.
    # Set to True temporarily if you need to see raw sidecar logs during debugging.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,   # Set per-run by the build scripts; None = host arch
    codesign_identity=None,
    entitlements_file=None,
)
