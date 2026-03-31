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
    FibonacciLevel,
    FibonacciResult,
    IndicatorResult,
    IndicatorValue,
)

log = logging.getLogger("parallax.indicators")

# ── Standard Fibonacci levels ────────────────────────────────
# These are the percentages where traders expect price to bounce.
# 61.8% is the "golden ratio" — the most important level.
FIBONACCI_LEVELS = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]


class IndicatorService:
    """
    Computes technical indicators from raw OHLCV candle data.

    Each indicator has its own method. The main entry point is
    compute() which takes a list of indicator names and runs
    the matching methods.
    """

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
            except Exception as exc:
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

        lower_col = f"BBL_{period}_{std_dev}"
        mid_col = f"BBM_{period}_{std_dev}"
        upper_col = f"BBU_{period}_{std_dev}"

        values: list[IndicatorValue] = []
        times = df["time"].values

        for i in range(len(df)):
            mid = bb[mid_col].iloc[i] if mid_col in bb else None
            upper = bb[upper_col].iloc[i] if upper_col in bb else None
            lower = bb[lower_col].iloc[i] if lower_col in bb else None

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

    # ── Fibonacci Retracement ────────────────────────────────

    def _compute_fibonacci(self, df: pd.DataFrame) -> FibonacciResult | None:
        """
        Fibonacci Retracement — Ofek's primary trading tool.

        How it works:
        1. Find the highest price (swing high) and lowest price (swing low)
           in the given data window
        2. Draw horizontal lines at key percentage levels between them:
           0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
        3. Traders watch these levels for price reactions (bounces, reversals)

        The 61.8% level (the "golden ratio") is considered the most important.
        If price retraces to 61.8% and bounces, that's a strong signal.

        This is the auto-detection version. Manual adjustment (drag endpoints)
        will be added in Task 4.5.
        """
        if len(df) < 10:
            log.warning("Not enough data for Fibonacci analysis (%d candles)", len(df))
            return None

        # Find swing high and swing low
        high_idx = df["high"].idxmax()
        low_idx = df["low"].idxmin()

        swing_high = float(df["high"].loc[high_idx])
        swing_low = float(df["low"].loc[low_idx])
        swing_high_time = int(df["time"].loc[high_idx])
        swing_low_time = int(df["time"].loc[low_idx])

        # Determine trend direction
        # If the high came AFTER the low, we're in an uptrend (drawing levels from low to high)
        # If the high came BEFORE the low, we're in a downtrend (drawing levels from high to low)
        if swing_high_time > swing_low_time:
            trend = "up"
        else:
            trend = "down"

        # Calculate price at each Fibonacci level
        price_range = swing_high - swing_low
        levels: list[FibonacciLevel] = []

        for level in FIBONACCI_LEVELS:
            if trend == "up":
                # In uptrend, levels are measured DOWN from the high
                price = swing_high - (price_range * level)
            else:
                # In downtrend, levels are measured UP from the low
                price = swing_low + (price_range * level)

            # Format the label nicely
            if level == 0.0:
                label = "0%"
            elif level == 1.0:
                label = "100%"
            else:
                label = f"{level * 100:.1f}%"

            levels.append(FibonacciLevel(
                level=level,
                price=round(price, 2),
                label=label,
            ))

        return FibonacciResult(
            swing_high=swing_high,
            swing_low=swing_low,
            swing_high_time=swing_high_time,
            swing_low_time=swing_low_time,
            levels=levels,
            trend=trend,
        )
