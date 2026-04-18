"""
Sector analysis service — sector performance + Relative Rotation Graph (RRG).

This service:
  1. Resolves sector ETF tickers to IBKR conids (cached after first call)
  2. Fetches YTD price data for all 11 SPDR sectors + SPY benchmark
  3. Computes RS-Ratio and RS-Momentum for the RRG (standard JdK method)

The RRG calculation:
  - RS-Ratio = EMA of (sector close / SPY close), normalized to 100
  - RS-Momentum = EMA of rate-of-change of RS-Ratio, normalized to 100
  - Quadrant assignment based on (RS-Ratio, RS-Momentum) relative to 100
"""

import asyncio
import datetime
import logging

from constants import (
    BREADTH_EMA_PERIOD,
    ROTATION_LOOKBACK_DAYS,
    ROTATION_RANGE_PCT,
    RRG_LOOKBACK_DAYS,
    RRG_MOMENTUM_PERIOD,
    RRG_RS_EMA_PERIOD,
    SECTOR_BENCHMARK,
    SECTOR_ETFS,
    SECTORS_DEFENSIVE,
    SECTORS_OFFENSIVE,
)
from services.ibkr import IBKRService
from services.indicators import IndicatorService

log = logging.getLogger("parallax.services.sectors")


class SectorService:
    """
    Computes sector performance and RRG data.
    Created once in the sector router, reused across requests.
    """

    def __init__(self, ibkr: IBKRService) -> None:
        self.ibkr = ibkr
        # Cache: symbol → conid (populated on first call)
        self._conid_cache: dict[str, int] = {}

    async def _resolve_conids(self) -> dict[str, int]:
        """
        Resolve all sector ETF + benchmark tickers to IBKR conids.
        Caches results — only calls IBKR search once per ticker.
        """
        all_symbols = [etf["symbol"] for etf in SECTOR_ETFS] + [SECTOR_BENCHMARK]
        missing = [s for s in all_symbols if s not in self._conid_cache]

        if missing:
            # Resolve missing symbols concurrently
            tasks = [self.ibkr.get_conid(sym) for sym in missing]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for sym, result in zip(missing, results):
                if isinstance(result, int):
                    self._conid_cache[sym] = result
                else:
                    log.warning("Could not resolve %s: %s", sym, result)

        return self._conid_cache

    async def get_sector_performance(self) -> list[dict]:
        """
        Fetch YTD performance for all 11 sector ETFs.
        Returns sorted by YTD % descending.
        """
        conids = await self._resolve_conids()

        # Build the list of sector conids we successfully resolved
        sector_data = []
        for etf in SECTOR_ETFS:
            conid = conids.get(etf["symbol"])
            if conid:
                sector_data.append({
                    "symbol": etf["symbol"],
                    "name": etf["name"],
                    "conid": conid,
                })

        if not sector_data:
            return []

        # Fetch all sector candles (YTD daily bars) concurrently
        # We need YTD data to calculate YTD performance
        today = datetime.date.today()
        start_of_year = datetime.date(today.year, 1, 1)
        days = (today - start_of_year).days + 1
        ibkr_period = f"{max(days, 30)}d"  # At least 30 days

        candle_tasks = [
            self.ibkr.history(s["conid"], period=ibkr_period, bar="1d")
            for s in sector_data
        ]
        candle_results = await asyncio.gather(*candle_tasks, return_exceptions=True)

        results = []
        for sector, candles_raw in zip(sector_data, candle_results):
            if isinstance(candles_raw, Exception):
                log.warning("Failed to fetch candles for %s: %s", sector["symbol"], candles_raw)
                results.append({**sector, "lastPrice": None, "changePercent": None, "ytdPercent": None})
                continue

            bars = candles_raw.get("data", [])
            if not bars:
                results.append({**sector, "lastPrice": None, "changePercent": None, "ytdPercent": None})
                continue

            first_close = bars[0].get("c")
            last_close = bars[-1].get("c")

            ytd_pct = None
            if first_close and last_close and first_close != 0:
                ytd_pct = round(((last_close - first_close) / first_close) * 100, 2)

            # Day change: last bar vs second-to-last
            day_change_pct = None
            if len(bars) >= 2:
                prev_close = bars[-2].get("c")
                if prev_close and last_close and prev_close != 0:
                    day_change_pct = round(((last_close - prev_close) / prev_close) * 100, 2)

            results.append({
                **sector,
                "lastPrice": last_close,
                "changePercent": day_change_pct,
                "ytdPercent": ytd_pct,
            })

        # Sort by YTD performance descending
        results.sort(key=lambda x: x.get("ytdPercent") or -999, reverse=True)
        return results

    async def get_rrg_data(self) -> list[dict]:
        """
        Compute Relative Rotation Graph data for all sector ETFs.

        Standard JdK RRG method:
          1. Get daily close prices for each sector + SPY (1 year lookback)
          2. Compute raw relative strength: RS = sector_close / spy_close
          3. Smooth with EMA(10) → RS-Ratio
          4. Compute rate of change of RS-Ratio, smooth with EMA(10) → RS-Momentum
          5. Normalize both to center at 100
          6. Assign quadrant based on position
        """
        conids = await self._resolve_conids()
        benchmark_conid = conids.get(SECTOR_BENCHMARK)
        if not benchmark_conid:
            log.error("Cannot compute RRG — benchmark %s not resolved", SECTOR_BENCHMARK)
            return []

        # Fetch benchmark + all sector daily data concurrently
        all_symbols = [SECTOR_BENCHMARK] + [etf["symbol"] for etf in SECTOR_ETFS]
        all_conids = [conids.get(s) for s in all_symbols]
        valid_pairs = [(s, c) for s, c in zip(all_symbols, all_conids) if c is not None]

        tasks = [
            self.ibkr.history(conid, period="1y", bar="1d")
            for _, conid in valid_pairs
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Parse close prices into {symbol: [close1, close2, ...]}
        close_data: dict[str, list[float]] = {}
        for (symbol, _), raw in zip(valid_pairs, results):
            if isinstance(raw, Exception):
                log.warning("RRG: failed to fetch %s: %s", symbol, raw)
                continue
            bars = raw.get("data", [])
            closes = [b["c"] for b in bars if "c" in b]
            if closes:
                close_data[symbol] = closes

        benchmark_closes = close_data.get(SECTOR_BENCHMARK)
        if not benchmark_closes:
            log.error("RRG: no benchmark data for %s", SECTOR_BENCHMARK)
            return []

        # Compute RRG for each sector
        rrg_points = []
        name_map = {etf["symbol"]: etf["name"] for etf in SECTOR_ETFS}

        for etf in SECTOR_ETFS:
            sym = etf["symbol"]
            sector_closes = close_data.get(sym)
            if not sector_closes:
                continue

            # Align lengths (use the shorter series)
            min_len = min(len(sector_closes), len(benchmark_closes))
            if min_len < RRG_RS_EMA_PERIOD + RRG_MOMENTUM_PERIOD + 5:
                continue  # Not enough data

            sector = sector_closes[-min_len:]
            bench = benchmark_closes[-min_len:]

            # Step 1: Raw relative strength ratio
            raw_rs = [s / b if b != 0 else 0 for s, b in zip(sector, bench)]

            # Step 2: EMA-smooth the RS → RS-Ratio
            rs_ratio_series = IndicatorService.ema_series(raw_rs, RRG_RS_EMA_PERIOD)

            # Step 3: Rate of change of RS-Ratio
            roc = _rate_of_change(rs_ratio_series, RRG_MOMENTUM_PERIOD)

            # Step 4: EMA-smooth the ROC → RS-Momentum
            rs_momentum_series = IndicatorService.ema_series(roc, RRG_RS_EMA_PERIOD)

            if not rs_ratio_series or not rs_momentum_series:
                continue

            # Normalize both series to center at 100 using the standard JdK method:
            # normalized = (value / series_mean) * 100
            # This makes 100 the neutral point — above 100 = above average, below = below average
            rs_ratio_mean = sum(rs_ratio_series) / len(rs_ratio_series) if rs_ratio_series else 1
            if rs_ratio_mean == 0:
                rs_ratio_mean = 1
            normalized_ratio = [(v / rs_ratio_mean) * 100 for v in rs_ratio_series]

            rs_momentum_mean = sum(rs_momentum_series) / len(rs_momentum_series) if rs_momentum_series else 1
            if rs_momentum_mean == 0:
                rs_momentum_mean = 1
            normalized_momentum = [(v / rs_momentum_mean) * 100 for v in rs_momentum_series]

            # Align the two series (momentum is shorter due to ROC calculation)
            trim = len(normalized_ratio) - len(normalized_momentum)
            if trim > 0:
                normalized_ratio = normalized_ratio[trim:]

            if not normalized_ratio or not normalized_momentum:
                continue

            # Current values (latest point)
            current_ratio = normalized_ratio[-1]
            current_momentum = normalized_momentum[-1]

            # Build trail (last 5 data points for animation)
            trail_len = min(5, len(normalized_ratio))
            trail = [
                {
                    "rs_ratio": round(normalized_ratio[-(trail_len - i)], 2),
                    "rs_momentum": round(normalized_momentum[-(trail_len - i)], 2),
                }
                for i in range(trail_len)
            ]

            # Assign quadrant
            quadrant = _get_quadrant(current_ratio, current_momentum)

            rrg_points.append({
                "symbol": sym,
                "name": name_map.get(sym, sym),
                "rs_ratio": round(current_ratio, 2),
                "rs_momentum": round(current_momentum, 2),
                "quadrant": quadrant,
                "trail": trail,
            })

        return rrg_points

    # ── Phase 8.9: Dashboard arc-gauge feeds ───────────────────

    async def get_market_breadth(self) -> dict:
        """
        "% of sector ETFs trading above their 50-day EMA" — breadth proxy.

        We use the 11 SPDR sector ETFs instead of all ~500 S&P constituents so
        we stay within IBKR rate limits while still producing a reasonable
        breadth signal (11 vote-weights across every sector of the index).

        Returns:
          {
            "value":       float,   # 0.0–100.0 — % of ETFs above 50-EMA
            "above":       int,     # how many ETFs are above
            "total":       int,     # how many we successfully computed on
            "etf_states": [
              {"symbol": "XLK", "above": true,  "close": 245.12, "ema50": 240.50},
              ...
            ],
          }
        """
        conids = await self._resolve_conids()

        # Pull enough history to seed a 50-period EMA with a buffer.
        bars_needed = BREADTH_EMA_PERIOD * 3  # ~150 bars
        period = f"{bars_needed}d"

        tasks = []
        syms_used = []
        for etf in SECTOR_ETFS:
            conid = conids.get(etf["symbol"])
            if conid is None:
                continue
            syms_used.append(etf["symbol"])
            tasks.append(self.ibkr.history(conid, period=period, bar="1d"))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        etf_states: list[dict] = []
        above = 0
        total = 0

        for sym, raw in zip(syms_used, results):
            if isinstance(raw, Exception):
                log.warning("breadth: %s fetch failed: %s", sym, raw)
                continue
            bars = raw.get("data", [])
            closes = [b["c"] for b in bars if "c" in b]
            if len(closes) < BREADTH_EMA_PERIOD:
                continue

            ema_series = IndicatorService.ema_series(closes, BREADTH_EMA_PERIOD)
            if not ema_series:
                continue

            last_close = closes[-1]
            last_ema = ema_series[-1]
            is_above = last_close > last_ema

            total += 1
            if is_above:
                above += 1

            etf_states.append({
                "symbol": sym,
                "above": is_above,
                "close": round(last_close, 2),
                "ema50": round(last_ema, 2),
            })

        value = round((above / total) * 100, 2) if total > 0 else 0.0

        return {
            "value": value,
            "above": above,
            "total": total,
            "etf_states": etf_states,
        }

    async def get_sector_rotation(self) -> dict:
        """
        Offensive vs Defensive sector performance over ~1 month (21 trading days).

        Offensive = XLK, XLY, XLC, XLF  (risk-on leaders)
        Defensive = XLP, XLU, XLV       (low-beta safe-haven sectors)

        Gauge mapping (Phase 8.9):
          delta = offensive_avg_pct − defensive_avg_pct
          gauge_value = clamp(((delta + RANGE) / (2 * RANGE)) * 100, 0, 100)
          - delta == -ROTATION_RANGE_PCT → 0   (fully defensive)
          - delta ==  0                  → 50  (neutral)
          - delta == +ROTATION_RANGE_PCT → 100 (fully offensive)

        Returns:
          {
            "value":          float,   # 0–100 gauge value
            "delta_pct":      float,   # offensive − defensive (percentage points)
            "offensive_pct":  float,   # avg 1-month perf of offensive ETFs
            "defensive_pct":  float,   # avg 1-month perf of defensive ETFs
            "lookback_days":  int,
            "offensive":      [{"symbol": ..., "pct": ...}, ...],
            "defensive":      [{"symbol": ..., "pct": ...}, ...],
          }
        """
        conids = await self._resolve_conids()

        # Request a tad more than the lookback so we always have enough bars.
        period = f"{ROTATION_LOOKBACK_DAYS + 5}d"

        all_syms = SECTORS_OFFENSIVE + SECTORS_DEFENSIVE
        valid_syms = [s for s in all_syms if conids.get(s) is not None]

        tasks = [
            self.ibkr.history(conids[s], period=period, bar="1d")
            for s in valid_syms
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        perf: dict[str, float] = {}
        for sym, raw in zip(valid_syms, results):
            if isinstance(raw, Exception):
                log.warning("rotation: %s fetch failed: %s", sym, raw)
                continue
            bars = raw.get("data", [])
            closes = [b["c"] for b in bars if "c" in b]
            if len(closes) < 2:
                continue

            # Use the close ~ROTATION_LOOKBACK_DAYS bars back (or the oldest
            # available if the series is shorter).
            lookback_idx = max(0, len(closes) - 1 - ROTATION_LOOKBACK_DAYS)
            anchor = closes[lookback_idx]
            last = closes[-1]
            if anchor == 0:
                continue
            perf[sym] = ((last - anchor) / anchor) * 100

        def _avg(syms: list[str]) -> float | None:
            picked = [perf[s] for s in syms if s in perf]
            return sum(picked) / len(picked) if picked else None

        offensive_avg = _avg(SECTORS_OFFENSIVE)
        defensive_avg = _avg(SECTORS_DEFENSIVE)

        if offensive_avg is None or defensive_avg is None:
            return {
                "value": 50.0,
                "delta_pct": 0.0,
                "offensive_pct": offensive_avg,
                "defensive_pct": defensive_avg,
                "lookback_days": ROTATION_LOOKBACK_DAYS,
                "offensive": [{"symbol": s, "pct": perf.get(s)} for s in SECTORS_OFFENSIVE],
                "defensive": [{"symbol": s, "pct": perf.get(s)} for s in SECTORS_DEFENSIVE],
            }

        delta = offensive_avg - defensive_avg
        # Map delta from [-ROTATION_RANGE_PCT, +ROTATION_RANGE_PCT] → [0, 100].
        gauge = ((delta + ROTATION_RANGE_PCT) / (2 * ROTATION_RANGE_PCT)) * 100
        gauge = max(0.0, min(100.0, gauge))

        return {
            "value": round(gauge, 2),
            "delta_pct": round(delta, 2),
            "offensive_pct": round(offensive_avg, 2),
            "defensive_pct": round(defensive_avg, 2),
            "lookback_days": ROTATION_LOOKBACK_DAYS,
            "offensive": [
                {"symbol": s, "pct": round(perf[s], 2) if s in perf else None}
                for s in SECTORS_OFFENSIVE
            ],
            "defensive": [
                {"symbol": s, "pct": round(perf[s], 2) if s in perf else None}
                for s in SECTORS_DEFENSIVE
            ],
        }


# ── Helper functions ────────────────────────────────────────
#
# EMA is provided by `IndicatorService.ema_series` — we reuse the
# pandas-ta bridge in services/indicators.py instead of rolling a
# parallel implementation here (CLAUDE.md rule 2).


def _rate_of_change(data: list[float], period: int) -> list[float]:
    """
    Compute rate of change: (current - N periods ago) / N periods ago.
    Returns a shorter list (len - period).
    """
    if len(data) <= period:
        return []

    return [
        (data[i] - data[i - period]) / data[i - period]
        if data[i - period] != 0 else 0
        for i in range(period, len(data))
    ]


def _get_quadrant(rs_ratio: float, rs_momentum: float) -> str:
    """Assign RRG quadrant based on RS-Ratio and RS-Momentum relative to 100."""
    if rs_ratio >= 100 and rs_momentum >= 100:
        return "leading"
    elif rs_ratio >= 100 and rs_momentum < 100:
        return "weakening"
    elif rs_ratio < 100 and rs_momentum < 100:
        return "lagging"
    else:  # ratio < 100, momentum >= 100
        return "improving"
