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

# pandas_ta isn't always available in lightweight test environments (minimal
# CI pre-installs, ephemeral sandboxes, etc.) — it's a third-party dep that
# many containers skip by default. When it's missing, stub it so unrelated
# tests (that don't touch indicator math) can still run. This is a no-op in
# any environment where pandas_ta is actually installed.
if "pandas_ta" not in sys.modules:
    try:
        import pandas_ta  # noqa: F401
    except ImportError:
        sys.modules["pandas_ta"] = types.ModuleType("pandas_ta")


# ---------------------------------------------------------------------------
# Shared fixture builders for prompt_facts tests.
# Subsequent tests import these directly: from tests.conftest import make_candle
# ---------------------------------------------------------------------------
from typing import Optional  # noqa: E402

from models import CandleData, IndicatorResult, IndicatorValue  # noqa: E402


def make_candle(
    close: float = 100.0,
    *,
    open: Optional[float] = None,
    high: Optional[float] = None,
    low: Optional[float] = None,
    volume: float = 1_000_000.0,
    time: int = 1_700_000_000,
) -> CandleData:
    return CandleData(
        time=time,
        open=open if open is not None else close - 0.5,
        high=high if high is not None else close + 1.0,
        low=low if low is not None else close - 1.0,
        close=close,
        volume=volume,
    )


def make_indicator(
    name: str,
    values: list[dict],
    *,
    type_: str = "oscillator",
    params: Optional[dict] = None,
    start_time: int = 1_700_000_000,
    bar_seconds: int = 86_400,
) -> IndicatorResult:
    """`values` is a list of partial dicts; each becomes one IndicatorValue.

    Example: make_indicator("rsi", [{"value": 55}, {"value": 60}])
    """
    iv_list = []
    for i, v in enumerate(values):
        iv_list.append(IndicatorValue(time=start_time + i * bar_seconds, **v))
    return IndicatorResult(
        name=name,
        type=type_,
        values=iv_list,
        params=params or {},
    )
