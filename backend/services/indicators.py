"""
Technical indicator computation service.

This is the math engine of Parallax. It takes raw price data (candles)
and computes all 14 technical indicators that traders use to make decisions.

How it works:
  1. Frontend sends a list of candles (price bars) and which indicators it wants
  2. This service converts the data to a Pandas DataFrame (because pandas-ta
     only works with Pandas — we'd love to use Polars but pandas-ta doesn't support it)
  3. It runs each requested indicator using pandas-ta
  4. It converts results back to our Pydantic models and returns them

The 14 indicators:
  RSI, MACD, EMA (9/21/50/200), Fibonacci, Volume+VolumeMA,
  Bollinger Bands, VWAP, ATR, Stochastic, OBV, ADX

Note on Pandas vs Polars:
  The CLAUDE.md says "use Polars, never Pandas." However, pandas-ta (our
  indicator library) only works with Pandas DataFrames. So we bridge:
  receive Polars-friendly data → convert to Pandas for computation →
  output as plain dicts/lists. Pandas is only used inside this file.
"""

import logging
import math
from typing import Any

import pandas as pd
import pandas_ta as ta

from models import (
    CandleData,
    FibonacciCandidate,
    FibonacciLevel,
    FibonacciResult,
    IndicatorResult,
    IndicatorValue,
)

log = logging.getLogger("parallax.indicators")

# ── Parallax Fibonacci levels ────────────────────────────────
# Ofek's methodology uses a non-standard set. 0.236 and 0.786 are
# intentionally excluded; the 0.618 / 0.65 / 0.716 "golden pocket" is
# the primary reaction zone.
FIB_RETRACEMENT_LEVELS: list[float] = [0.0, 0.382, 0.5, 0.618, 0.65, 0.716, 1.0]
FIB_EXTENSION_LEVELS: list[float] = [
    1.272, 1.414, 1.5, 1.618, 1.786, 2.0, 2.618, 3.0, 3.618, 4.0, 4.618,
]
GOLDEN_POCKET_LEVELS: set[float] = {0.618, 0.65, 0.716}

# Pivot detection window. A bar is a swing high/low if its high/low is
# the most extreme within ±PIVOT_WINDOW bars on either side.
PIVOT_WINDOW = 5

# Maximum candidate swings to score + return
MAX_CANDIDATES = 6

# Scoring weights (fixed for v1 — learning algorithm is v2 scope).
# These must sum to 1.0.
_WEIGHTS = {
    "swing_clarity":       0.25,
    "multi_touch":         0.25,
    "rejection_intensity": 0.20,
    "stretched_penalty":   0.15,
    "recency":             0.15,
}


class IndicatorService:
    """
    Computes technical indicators from raw OHLCV candle data.

    Each indicator has its own method. The main entry point is
    compute() which takes a list of indicator names and runs
    the matching methods.
    """

    # ── Public helpers for non-candle callers ────────────────
    #
    # Other services (e.g. SectorService) sometimes have raw close-price
    # lists rather than CandleData objects and just need a rolling EMA.
    # They call `ema_series(closes, period)` instead of rolling their own —
    # this keeps the pandas-ta bridge in a single file (CLAUDE.md rule 2:
    # "pandas-ta is the only exception (bridged)").
    @staticmethod
    def ema_series(values: list[float], period: int) -> list[float]:
        """
        Compute an Exponential Moving Average over a plain list of floats.

        Uses the same pandas-ta engine as `_compute_ema` (SMA-seeded EMA
        with alpha = 2 / (period + 1)) so values are numerically identical
        to the candle-based indicator path.

        Returns the non-NaN tail of the EMA series. Length equals
        max(0, len(values) - period + 1). Empty list if there isn't
        enough data to seed the EMA.
        """
        if len(values) < period:
            return []
        ema = ta.ema(pd.Series(values), length=period)
        if ema is None or ema.empty:
            return []
        return [float(v) for v in ema.to_numpy() if not math.isnan(v)]

    def compute(
        self,
        candles: list[CandleData],
        indicators: list[str],
    ) -> tuple[list[IndicatorResult], FibonacciResult | None]:
        """
        Main entry point — compute requested indicators from candle data.

        Args:
            candles: Raw OHLCV price bars from IBKR.
            indicators: List of indicator names to compute
                       (e.g., ["rsi", "macd", "ema_50"])

        Returns:
            A tuple of (indicator_results, fibonacci_result).
            fibonacci_result is None if "fibonacci" wasn't requested.
        """
        if not candles or len(candles) < 2:
            log.warning("Not enough candle data to compute indicators (%d candles)", len(candles))
            return [], None

        # Convert our candle models to a Pandas DataFrame
        # (pandas-ta needs Pandas — this is the only place we use it)
        df = self._candles_to_dataframe(candles)

        results: list[IndicatorResult] = []
        fibonacci: FibonacciResult | None = None

        # Map of indicator names to their computation methods
        # Each method takes the DataFrame and returns an IndicatorResult
        indicator_map: dict[str, Any] = {
            "rsi": self._compute_rsi,
            "macd": self._compute_macd,
            "ema_9": lambda df: self._compute_ema(df, period=9),
            "ema_21": lambda df: self._compute_ema(df, period=21),
            "ema_50": lambda df: self._compute_ema(df, period=50),
            "ema_200": lambda df: self._compute_ema(df, period=200),
            "bbands": self._compute_bollinger_bands,
            "vwap": self._compute_vwap,
            "atr": self._compute_atr,
            "stoch": self._compute_stochastic,
            "obv": self._compute_obv,
            "adx": self._compute_adx,
            "volume": self._compute_volume,
        }

        for name in indicators:
            name_lower = name.lower()

            if name_lower == "fibonacci":
                fibonacci = self._compute_fibonacci(df)
                continue

            compute_fn = indicator_map.get(name_lower)
            if compute_fn is None:
                log.warning("Unknown indicator requested: %s", name)
                continue

            try:
                result = compute_fn(df)
                if result is not None:
                    results.append(result)
            except (ValueError, KeyError, TypeError, ZeroDivisionError) as exc:
                log.error("Error computing %s: %s", name, exc)

        return results, fibonacci

    # ── Data Conversion ──────────────────────────────────────

    def _candles_to_dataframe(self, candles: list[CandleData]) -> pd.DataFrame:
        """
        Convert our CandleData models to a Pandas DataFrame.

        pandas-ta expects specific column names: open, high, low, close, volume.
        We also keep the 'time' column for mapping results back to timestamps.
        """
        data = {
            "time": [c.time for c in candles],
            "open": [c.open for c in candles],
            "high": [c.high for c in candles],
            "low": [c.low for c in candles],
            "close": [c.close for c in candles],
            "volume": [c.volume for c in candles],
        }
        df = pd.DataFrame(data)
        # pandas-ta works best with a DatetimeIndex
        df.index = pd.to_datetime(df["time"], unit="s")
        return df

    def _series_to_values(
        self, df: pd.DataFrame, series: pd.Series, field: str = "value"
    ) -> list[IndicatorValue]:
        """
        Convert a Pandas Series (one column of results) into our
        IndicatorValue format, paired with the timestamps from the DataFrame.

        Skips NaN values (which happen at the start because indicators
        need some history before they can produce a value — for example,
        a 14-period RSI can't produce a result until you have 14 candles).
        """
        values: list[IndicatorValue] = []
        times = df["time"].values
        for i, val in enumerate(series):
            if pd.isna(val) or (isinstance(val, float) and math.isnan(val)):
                continue
            kwargs: dict[str, Any] = {"time": int(times[i])}
            kwargs[field] = float(val)
            values.append(IndicatorValue(**kwargs))
        return values

    # ── Individual Indicator Computations ────────────────────
    #
    # Each method below computes one indicator and returns an
    # IndicatorResult with the computed values.
    #
    # The patterns are similar:
    #   1. Call pandas-ta to compute the indicator
    #   2. Convert the results to IndicatorValue objects
    #   3. Wrap in an IndicatorResult with metadata

    def _compute_rsi(self, df: pd.DataFrame, period: int = 14) -> IndicatorResult:
        """
        RSI (Relative Strength Index) — measures momentum.

        Range: 0 to 100.
        - Above 70 = "overbought" (price may have risen too fast)
        - Below 30 = "oversold" (price may have fallen too far)

        Displayed as an oscillator below the chart.
        """
        rsi = ta.rsi(df["close"], length=period)
        return IndicatorResult(
            name="rsi",
            type="oscillator",
            values=self._series_to_values(df, rsi),
            params={"period": period},
        )

    def _compute_macd(
        self, df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9
    ) -> IndicatorResult:
        """
        MACD (Moving Average Convergence Divergence) — trend + momentum.

        Three parts:
        - MACD line: difference between fast EMA and slow EMA
        - Signal line: an EMA of the MACD line
        - Histogram: the gap between MACD and signal (shows momentum)

        When MACD crosses above signal = bullish.
        When MACD crosses below signal = bearish.

        Displayed as an oscillator below the chart.
        """
        macd_df = ta.macd(df["close"], fast=fast, slow=slow, signal=signal)
        if macd_df is None or macd_df.empty:
            return IndicatorResult(name="macd", type="oscillator", values=[], params={})

        # pandas-ta returns columns named like: MACD_12_26_9, MACDs_12_26_9, MACDh_12_26_9
        macd_col = f"MACD_{fast}_{slow}_{signal}"
        signal_col = f"MACDs_{fast}_{slow}_{signal}"
        hist_col = f"MACDh_{fast}_{slow}_{signal}"

        values: list[IndicatorValue] = []
        times = df["time"].values

        for i in range(len(df)):
            m = macd_df[macd_col].iloc[i] if macd_col in macd_df else None
            s = macd_df[signal_col].iloc[i] if signal_col in macd_df else None
            h = macd_df[hist_col].iloc[i] if hist_col in macd_df else None

            # Skip rows where all values are NaN
            if pd.isna(m) and pd.isna(s) and pd.isna(h):
                continue

            values.append(IndicatorValue(
                time=int(times[i]),
                value=float(m) if not pd.isna(m) else None,
                signal=float(s) if not pd.isna(s) else None,
                histogram=float(h) if not pd.isna(h) else None,
            ))

        return IndicatorResult(
            name="macd",
            type="oscillator",
            values=values,
            params={"fast": fast, "slow": slow, "signal": signal},
        )

    def _compute_ema(self, df: pd.DataFrame, period: int) -> IndicatorResult:
        """
        EMA (Exponential Moving Average) — smoothed price trend line.

        Different periods show different trends:
        - EMA 9:   Very fast, follows price closely (scalping/day trading)
        - EMA 21:  Short-term trend
        - EMA 50:  Medium-term trend
        - EMA 200: Long-term trend (the "big picture")

        When price is above the EMA = bullish. Below = bearish.
        When a short EMA crosses above a long EMA = "golden cross" (very bullish).

        Displayed as a line directly on the price chart.
        """
        ema = ta.ema(df["close"], length=period)
        return IndicatorResult(
            name=f"ema_{period}",
            type="overlay",
            values=self._series_to_values(df, ema),
            params={"period": period},
        )

    def _compute_bollinger_bands(
        self, df: pd.DataFrame, period: int = 20, std_dev: float = 2.0
    ) -> IndicatorResult:
        """
        Bollinger Bands — volatility envelope around price.

        Three lines:
        - Middle: 20-period SMA (simple moving average)
        - Upper: middle + 2 standard deviations
        - Lower: middle - 2 standard deviations

        When bands are wide = high volatility (big price swings).
        When bands are narrow = low volatility (quiet, breakout may come).
        When price touches upper band = potentially overbought.
        When price touches lower band = potentially oversold.

        Displayed as three lines on the price chart.
        """
        bb = ta.bbands(df["close"], length=period, std=std_dev)
        if bb is None or bb.empty:
            return IndicatorResult(name="bbands", type="overlay", values=[], params={})

        # pandas-ta column names depend on version and float formatting.
        # "BBL_20_2.0" is typical but some builds emit "BBL_20_2" or "BBL_20_2.00".
        # Use prefix matching so the column is found regardless of trailing zeros.
        actual_cols = list(bb.columns)
        lower_col = next((c for c in actual_cols if c.startswith("BBL_")), None)
        mid_col   = next((c for c in actual_cols if c.startswith("BBM_")), None)
        upper_col = next((c for c in actual_cols if c.startswith("BBU_")), None)

        if not lower_col or not mid_col or not upper_col:
            log.warning(
                "bbands: unexpected column names from pandas-ta (got %s) — "
                "cannot extract lower/mid/upper bands",
                actual_cols,
            )
            return IndicatorResult(name="bbands", type="overlay", values=[], params={})

        log.debug("bbands: resolved columns → lower=%s mid=%s upper=%s", lower_col, mid_col, upper_col)

        values: list[IndicatorValue] = []
        times = df["time"].values

        for i in range(len(df)):
            mid   = bb[mid_col].iloc[i]
            upper = bb[upper_col].iloc[i]
            lower = bb[lower_col].iloc[i]

            if pd.isna(mid) and pd.isna(upper) and pd.isna(lower):
                continue

            values.append(IndicatorValue(
                time=int(times[i]),
                value=float(mid) if not pd.isna(mid) else None,
                upper=float(upper) if not pd.isna(upper) else None,
                lower=float(lower) if not pd.isna(lower) else None,
            ))

        return IndicatorResult(
            name="bbands",
            type="overlay",
            values=values,
            params={"period": period, "std_dev": std_dev},
        )

    def _compute_vwap(self, df: pd.DataFrame) -> IndicatorResult:
        """
        VWAP (Volume Weighted Average Price) — the "fair price" of the day.

        It's the average price weighted by volume. Big trades at $100
        matter more than small trades at $105.

        Institutional traders (the big players) use VWAP as a benchmark.
        - Price above VWAP = buyers are in control
        - Price below VWAP = sellers are in control

        Mainly useful for intraday trading.
        Displayed as a line on the price chart.
        """
        vwap = ta.vwap(df["high"], df["low"], df["close"], df["volume"])
        if vwap is None or vwap.empty:
            return IndicatorResult(name="vwap", type="overlay", values=[], params={})

        return IndicatorResult(
            name="vwap",
            type="overlay",
            values=self._series_to_values(df, vwap),
            params={},
        )

    def _compute_atr(self, df: pd.DataFrame, period: int = 14) -> IndicatorResult:
        """
        ATR (Average True Range) — measures volatility.

        Higher ATR = bigger price swings.
        Used for:
        - Setting stop losses (e.g., "2x ATR below entry")
        - Position sizing (more volatile = smaller position)
        - Identifying breakouts (ATR expanding = trend starting)

        Not shown on the chart — it's a single number value.
        """
        atr = ta.atr(df["high"], df["low"], df["close"], length=period)
        return IndicatorResult(
            name="atr",
            type="value",
            values=self._series_to_values(df, atr),
            params={"period": period},
        )

    def _compute_stochastic(
        self, df: pd.DataFrame, k_period: int = 14, d_period: int = 3, smooth: int = 3
    ) -> IndicatorResult:
        """
        Stochastic Oscillator — momentum overbought/oversold.

        Two lines:
        - %K: Where current price is relative to the high/low range
        - %D: A smoothed version of %K (the "signal" line)

        Range: 0 to 100.
        - Above 80 = overbought (might reverse down)
        - Below 20 = oversold (might reverse up)
        - K crossing above D = bullish
        - K crossing below D = bearish

        Displayed as an oscillator below the chart.
        """
        stoch = ta.stoch(df["high"], df["low"], df["close"], k=k_period, d=d_period, smooth_k=smooth)
        if stoch is None or stoch.empty:
            return IndicatorResult(name="stoch", type="oscillator", values=[], params={})

        k_col = f"STOCHk_{k_period}_{d_period}_{smooth}"
        d_col = f"STOCHd_{k_period}_{d_period}_{smooth}"

        values: list[IndicatorValue] = []
        times = df["time"].values

        for i in range(len(df)):
            k_val = stoch[k_col].iloc[i] if k_col in stoch else None
            d_val = stoch[d_col].iloc[i] if d_col in stoch else None

            if pd.isna(k_val) and pd.isna(d_val):
                continue

            values.append(IndicatorValue(
                time=int(times[i]),
                value=float(k_val) if not pd.isna(k_val) else None,
                signal=float(d_val) if not pd.isna(d_val) else None,
            ))

        return IndicatorResult(
            name="stoch",
            type="oscillator",
            values=values,
            params={"k": k_period, "d": d_period, "smooth": smooth},
        )

    def _compute_obv(self, df: pd.DataFrame) -> IndicatorResult:
        """
        OBV (On-Balance Volume) — volume-price confirmation.

        Adds volume on up-days, subtracts on down-days.
        If price is rising AND OBV is rising = real buying pressure (good).
        If price is rising but OBV is flat/falling = weak rally (careful).

        Displayed as a line below the chart.
        """
        obv = ta.obv(df["close"], df["volume"])
        return IndicatorResult(
            name="obv",
            type="line",
            values=self._series_to_values(df, obv),
            params={},
        )

    def _compute_adx(self, df: pd.DataFrame, period: int = 14) -> IndicatorResult:
        """
        ADX (Average Directional Index) — trend strength.

        Range: 0 to 100.
        - Below 20 = no trend (choppy, range-bound market)
        - 20-40 = developing trend
        - Above 40 = strong trend
        - Above 60 = very strong trend

        ADX doesn't tell you direction — just how strong the trend is.
        Displayed as a value indicator.
        """
        adx = ta.adx(df["high"], df["low"], df["close"], length=period)
        if adx is None or adx.empty:
            return IndicatorResult(name="adx", type="value", values=[], params={})

        adx_col = f"ADX_{period}"
        if adx_col not in adx.columns:
            return IndicatorResult(name="adx", type="value", values=[], params={})

        return IndicatorResult(
            name="adx",
            type="value",
            values=self._series_to_values(df, adx[adx_col]),
            params={"period": period},
        )

    def _compute_volume(self, df: pd.DataFrame, ma_period: int = 20) -> IndicatorResult:
        """
        Volume + Volume Moving Average.

        Volume = how many shares traded in each period.
        Volume MA = smoothed average volume (20-period by default).

        High volume + price move = conviction (the move is "real").
        Low volume + price move = questionable (might reverse).
        Volume spike = something big is happening.

        Displayed as a histogram below the chart.
        """
        vol_ma = ta.sma(df["volume"], length=ma_period)

        values: list[IndicatorValue] = []
        times = df["time"].values

        for i in range(len(df)):
            vol = df["volume"].iloc[i]
            ma = vol_ma.iloc[i] if vol_ma is not None and not pd.isna(vol_ma.iloc[i]) else None

            values.append(IndicatorValue(
                time=int(times[i]),
                value=float(vol),
                signal=float(ma) if ma is not None else None,
            ))

        return IndicatorResult(
            name="volume",
            type="histogram",
            values=values,
            params={"ma_period": ma_period},
        )

    # ── Fibonacci (Ofek's primary tool) ──────────────────────
    #
    # This is the core of task 4.4. The implementation is deliberately
    # self-contained — it does NOT read EMAs, watchlists, or any other
    # indicator. Cross-indicator confluence (fib level sitting on an
    # EMA, watchlist-aware framing, etc.) happens at the LLM prompt
    # layer in services/ai.py — see parallax-v2-roadmap skill for the
    # architectural boundary.
    #
    # The algorithm:
    #   1. Find fractal pivot highs and lows (±PIVOT_WINDOW bars)
    #   2. Form every plausible swing pair (pivot low → pivot high and
    #      vice versa, oriented by which came later)
    #   3. Score each swing by swing_clarity, multi-touch count,
    #      rejection intensity, stretched penalty, recency
    #   4. Rank candidates, pick the top one as the active fib
    #   5. Tag nested candidates (entirely inside a higher-scoring one)
    #   6. Assess timeframe clarity — clean (clear winner) vs choppy
    #      (many competing high-scoring candidates)
    #   7. Return retracement AND extension levels from the winning swing
    #
    # Cross-timeframe fib-to-fib convergence is NOT done here (this
    # service sees one timeframe at a time). A post-processing helper
    # in services/ai.py can populate convergence_zones once multi-TF
    # results are assembled.

    def _compute_fibonacci(
        self,
        df: pd.DataFrame,
        tool_mode: str = "retracement",
    ) -> FibonacciResult | None:
        """
        Auto-detect the best swing on this timeframe and return a full
        fib analysis (candidates, scoring, retracement + extension levels).

        Args:
            df: OHLCV DataFrame with columns open/high/low/close/volume/time
            tool_mode: "retracement" (primary entry tool) or "extension"
                       (primary target tool). Both level sets are computed
                       regardless — tool_mode just flags which is the
                       primary rendering intent.
        """
        if len(df) < (PIVOT_WINDOW * 2 + 5):
            log.warning(
                "Not enough data for Fibonacci analysis (%d candles, need %d)",
                len(df), PIVOT_WINDOW * 2 + 5,
            )
            return None

        # 1. Find pivot highs and lows via fractal detection
        pivot_highs, pivot_lows = self._find_pivots(df, window=PIVOT_WINDOW)
        if not pivot_highs or not pivot_lows:
            log.info("No fractal pivots found — falling back to global extremes")
            # Use positional indices (df has a DatetimeIndex, so label-based
            # idxmax returns a Timestamp — we need positional for iloc).
            highs_arr = df["high"].to_numpy()
            lows_arr = df["low"].to_numpy()
            pivot_highs = [int(highs_arr.argmax())]
            pivot_lows = [int(lows_arr.argmin())]

        # 2. Build candidate swings. For each pivot low, pair with every
        #    pivot high that came later (→ uptrend swing). And vice
        #    versa for downtrend swings.
        raw_candidates: list[dict] = []
        for lo in pivot_lows:
            for hi in pivot_highs:
                if hi == lo:
                    continue
                if hi > lo:
                    raw_candidates.append({"lo_idx": lo, "hi_idx": hi, "direction": "up"})
                else:
                    raw_candidates.append({"lo_idx": lo, "hi_idx": hi, "direction": "down"})

        if not raw_candidates:
            return None

        # 3. Score every candidate. The scoring is pure fib-internal.
        current_price = float(df["close"].iloc[-1])
        scored: list[FibonacciCandidate] = []
        for rc in raw_candidates:
            cand = self._score_swing(
                df,
                lo_idx=rc["lo_idx"],
                hi_idx=rc["hi_idx"],
                direction=rc["direction"],
                current_price=current_price,
            )
            if cand is not None:
                scored.append(cand)

        if not scored:
            return None

        # 4. Rank and trim
        scored.sort(key=lambda c: c.score, reverse=True)
        scored = scored[:MAX_CANDIDATES]

        # 5. Nesting detection — a candidate is nested if its price range
        #    is entirely inside a higher-scoring candidate's range AND its
        #    time range is also inside (same TF).
        for i, child in enumerate(scored):
            for j, parent in enumerate(scored):
                if j >= i:
                    continue  # parents must be higher-scored (earlier in list)
                child_lo = min(child.swing_low, child.swing_high)
                child_hi = max(child.swing_low, child.swing_high)
                parent_lo = min(parent.swing_low, parent.swing_high)
                parent_hi = max(parent.swing_low, parent.swing_high)
                child_t0 = min(child.swing_low_time, child.swing_high_time)
                child_t1 = max(child.swing_low_time, child.swing_high_time)
                parent_t0 = min(parent.swing_low_time, parent.swing_high_time)
                parent_t1 = max(parent.swing_low_time, parent.swing_high_time)
                if (
                    child_lo >= parent_lo and child_hi <= parent_hi
                    and child_t0 >= parent_t0 and child_t1 <= parent_t1
                ):
                    child.is_nested = True
                    child.parent_index = j
                    break

        top = scored[0]

        # 6. Timeframe clarity — clean if the top candidate leads the
        #    next by a comfortable margin, choppy otherwise.
        if len(scored) >= 2:
            margin = top.score - scored[1].score
            tf_clarity = "clean" if margin >= 15.0 else "choppy"
        else:
            tf_clarity = "clean"

        # 7. Compute the active fib levels from the winning swing
        levels = self._build_levels(
            swing_low=top.swing_low,
            swing_high=top.swing_high,
            direction=top.direction,
            ratios=FIB_RETRACEMENT_LEVELS,
            kind="retracement",
        )
        extensions = self._build_levels(
            swing_low=top.swing_low,
            swing_high=top.swing_high,
            direction=top.direction,
            ratios=FIB_EXTENSION_LEVELS,
            kind="extension",
        )

        reasoning = self._build_reasoning(top, scored, current_price, tf_clarity)

        return FibonacciResult(
            tool_mode=tool_mode,
            swing_high=top.swing_high,
            swing_low=top.swing_low,
            swing_high_time=top.swing_high_time,
            swing_low_time=top.swing_low_time,
            direction=top.direction,
            levels=levels,
            extensions=extensions,
            score=top.score,
            swing_clarity=top.swing_clarity,
            timeframe_clarity=tf_clarity,
            candidates=scored,
            convergence_zones=[],  # populated later by cross-TF post-processor
            is_nested=top.is_nested,
            parent_fib_id=None,
            reasoning=reasoning,
            source="auto",
        )

    # ── Fib helpers ──────────────────────────────────────────

    @staticmethod
    def _find_pivots(
        df: pd.DataFrame, window: int = PIVOT_WINDOW,
    ) -> tuple[list[int], list[int]]:
        """
        Fractal pivot detection.

        A bar at index i is a pivot high if high[i] is strictly greater
        than the high of every bar in [i-window, i+window] excluding
        itself. Symmetric for pivot lows.

        Returns (pivot_high_indices, pivot_low_indices), both as plain
        Python ints referencing df positional index (df is 0-indexed
        here because we reset it in _candles_to_dataframe).
        """
        highs = df["high"].to_numpy()
        lows = df["low"].to_numpy()
        n = len(df)
        pivot_highs: list[int] = []
        pivot_lows: list[int] = []
        for i in range(window, n - window):
            hi_slice = highs[i - window : i + window + 1]
            lo_slice = lows[i - window : i + window + 1]
            if highs[i] == hi_slice.max() and (hi_slice == highs[i]).sum() == 1:
                pivot_highs.append(i)
            if lows[i] == lo_slice.min() and (lo_slice == lows[i]).sum() == 1:
                pivot_lows.append(i)
        return pivot_highs, pivot_lows

    def _score_swing(
        self,
        df: pd.DataFrame,
        lo_idx: int,
        hi_idx: int,
        direction: str,
        current_price: float,
    ) -> FibonacciCandidate | None:
        """
        Score a single swing candidate using fib-internal factors only.

        Returns a FibonacciCandidate with the composite score (0-100)
        and each individual factor exposed for the LLM to cite.
        """
        swing_high = float(df["high"].iloc[hi_idx])
        swing_low = float(df["low"].iloc[lo_idx])
        price_range = swing_high - swing_low
        if price_range <= 0:
            return None

        swing_high_time = int(df["time"].iloc[hi_idx])
        swing_low_time = int(df["time"].iloc[lo_idx])

        # For post-swing analysis we look at bars AFTER the later pivot.
        later_idx = max(lo_idx, hi_idx)
        post = df.iloc[later_idx + 1 :]

        # --- swing_clarity: how clean is the V-shape? ---
        # Measure: price_range relative to average post-swing ATR-like
        # noise. High ratio = big clean swing, low ratio = swing barely
        # bigger than routine bar ranges (noisy).
        if len(post) >= 5:
            bar_ranges = (post["high"] - post["low"]).to_numpy()
            avg_bar_range = float(bar_ranges.mean()) if len(bar_ranges) else 0.0
        else:
            avg_bar_range = float((df["high"] - df["low"]).mean())
        if avg_bar_range > 0:
            clarity_ratio = price_range / avg_bar_range
            swing_clarity = min(1.0, clarity_ratio / 15.0)  # 15x = perfect
        else:
            swing_clarity = 0.5

        # --- multi_touch: how many times did price come back to the
        #     golden pocket (0.618-0.716) after the swing completed?
        gp_top_ratio = 0.716
        gp_bot_ratio = 0.618
        if direction == "up":
            gp_high = swing_high - price_range * gp_bot_ratio
            gp_low = swing_high - price_range * gp_top_ratio
        else:
            gp_low = swing_low + price_range * gp_bot_ratio
            gp_high = swing_low + price_range * gp_top_ratio
        if gp_low > gp_high:
            gp_low, gp_high = gp_high, gp_low

        multi_touch_count = 0
        if len(post) > 0:
            post_lows = post["low"].to_numpy()
            post_highs = post["high"].to_numpy()
            in_zone = (post_highs >= gp_low) & (post_lows <= gp_high)
            # Count transitions into the zone (rising edge)
            for k in range(len(in_zone)):
                if in_zone[k] and (k == 0 or not in_zone[k - 1]):
                    multi_touch_count += 1

        # --- rejection_intensity: biggest reversal at golden pocket ---
        # For each touch, measure how quickly price left the zone.
        rejection_intensity = 0.0
        if len(post) > 2 and multi_touch_count > 0:
            post_closes = post["close"].to_numpy()
            post_lows = post["low"].to_numpy()
            post_highs = post["high"].to_numpy()
            for k in range(len(post_closes) - 2):
                touch = (post_highs[k] >= gp_low) and (post_lows[k] <= gp_high)
                if not touch:
                    continue
                # Reversal over next 3 bars
                forward = post_closes[k + 1 : k + 4]
                if len(forward) == 0:
                    continue
                move = (forward.max() - post_closes[k]) if direction == "up" \
                    else (post_closes[k] - forward.min())
                rel = move / price_range if price_range > 0 else 0.0
                rejection_intensity = max(rejection_intensity, min(1.0, rel * 4.0))

        # --- stretched_penalty: how far is current price from the
        #     golden pocket, relative to the swing range? Close = 1.0,
        #     far = 0.0.
        gp_center = (gp_low + gp_high) / 2.0
        dist = abs(current_price - gp_center)
        rel_dist = dist / price_range if price_range > 0 else 1.0
        stretched_penalty = max(0.0, 1.0 - rel_dist)  # cap at 0

        # --- recency: most recent swing → 1.0, oldest → 0.0 ---
        total_bars = len(df)
        recency = later_idx / max(1, total_bars - 1)

        composite = (
            _WEIGHTS["swing_clarity"]       * swing_clarity
            + _WEIGHTS["multi_touch"]       * min(1.0, multi_touch_count / 3.0)
            + _WEIGHTS["rejection_intensity"] * rejection_intensity
            + _WEIGHTS["stretched_penalty"] * stretched_penalty
            + _WEIGHTS["recency"]           * recency
        )
        score = round(composite * 100.0, 1)

        return FibonacciCandidate(
            swing_high=round(swing_high, 4),
            swing_low=round(swing_low, 4),
            swing_high_time=swing_high_time,
            swing_low_time=swing_low_time,
            direction=direction,
            score=score,
            swing_clarity=round(swing_clarity, 3),
            multi_touch_count=multi_touch_count,
            rejection_intensity=round(rejection_intensity, 3),
            stretched_penalty=round(stretched_penalty, 3),
            recency=round(recency, 3),
        )

    @staticmethod
    def _build_levels(
        swing_low: float,
        swing_high: float,
        direction: str,
        ratios: list[float],
        kind: str,
    ) -> list[FibonacciLevel]:
        """
        Compute FibonacciLevel entries for a given swing + ratio set.

        Retracement levels live inside [swing_low, swing_high] for both
        directions. Extension levels project beyond the swing in the
        direction of the trend (above swing_high for "up", below
        swing_low for "down").
        """
        price_range = swing_high - swing_low
        levels: list[FibonacciLevel] = []
        for ratio in ratios:
            if kind == "retracement":
                if direction == "up":
                    price = swing_high - price_range * ratio
                else:
                    price = swing_low + price_range * ratio
            else:  # extension
                if direction == "up":
                    price = swing_high + price_range * (ratio - 1.0)
                else:
                    price = swing_low - price_range * (ratio - 1.0)
            is_gp = ratio in GOLDEN_POCKET_LEVELS
            if ratio == 0.0:
                label = "0"
            elif ratio == 1.0:
                label = "1.0"
            elif is_gp:
                label = f"{ratio:g} (GP)"
            else:
                label = f"{ratio:g}"
            levels.append(FibonacciLevel(
                level=ratio,
                price=round(price, 4),
                label=label,
                kind=kind,
                golden_pocket=is_gp,
            ))
        return levels

    @staticmethod
    def _build_reasoning(
        top: FibonacciCandidate,
        all_candidates: list[FibonacciCandidate],
        current_price: float,
        tf_clarity: str,
    ) -> str:
        """Produce an LLM-friendly explanation of why this swing was chosen."""
        parts = [
            f"Active fib: {top.direction} swing from ${top.swing_low:.2f} → ${top.swing_high:.2f} "
            f"(score {top.score:.1f}/100).",
            f"Factors — clarity={top.swing_clarity:.2f}, multi_touch={top.multi_touch_count}, "
            f"rejection={top.rejection_intensity:.2f}, stretched={top.stretched_penalty:.2f}, "
            f"recency={top.recency:.2f}.",
            f"Timeframe clarity: {tf_clarity}.",
        ]
        if len(all_candidates) > 1:
            parts.append(
                f"Considered {len(all_candidates)} candidates; "
                f"second-best scored {all_candidates[1].score:.1f}."
            )
        if top.is_nested:
            parts.append("This candidate is nested inside a higher-scoring parent fib.")
        return " ".join(parts)
