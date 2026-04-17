"""
Shared pytest config.

The backend modules import by bare name (`from models import ...`) rather
than as a package, so pytest's rootdir needs the backend/ folder on sys.path.
"""
import sys
import types
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# pandas_ta requires Python >=3.12 and isn't always available in lightweight
# test environments (CI pre-installs, sandboxes, etc.). When it's missing, stub
# it so unrelated tests (that don't touch indicator math) can still run. This
# is a no-op in any environment where pandas_ta is actually installed.
if "pandas_ta" not in sys.modules:
    try:
        import pandas_ta  # noqa: F401
    except ImportError:
        sys.modules["pandas_ta"] = types.ModuleType("pandas_ta")
