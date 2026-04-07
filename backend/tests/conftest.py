"""
Shared pytest config.

The backend modules import by bare name (`from models import ...`) rather
than as a package, so pytest's rootdir needs the backend/ folder on sys.path.
"""
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
