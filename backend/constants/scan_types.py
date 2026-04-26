"""
Curated IBKR scanner scan-type catalogue used by the Parallax screener.

This is the OPINIONATED list — only the scan types we expose as named
presets in the UI. Each `code` here is grep-verified against IBKR's live
`/iserver/scanner/params` dump. The full IBKR catalogue (~60 scan types)
is exposed separately via the "Browse all scans" panel.

The screener service joins this list with the live `scan_type_list` from
IBKR at request time so each entry gets the real `instruments: [...]`
compatibility array (which markets/instruments support the scan). That
way our naming + ordering + grouping stays under our control while the
compatibility info stays correct as IBKR evolves their catalogue.

Categories drive both:
  - the "More screens" section grouping in the preset dropdown
  - the section grouping in the Browse all scans panel

`popular=True` entries are surfaced at the top of the preset dropdown
without category grouping.
"""

from typing import Any

# Subtitles (italic hint shown under the preset name in the UI) — used
# sparingly to flag operational windows or instrument quirks the user
# should know about before they wonder why a scan returns 0 rows.
_PREMARKET = "Pre-market only"
_AFTERHOURS = "After-hours only"
_OPTIONS_HOSTS = "Underlyings with listed options"

CURATED_SCAN_TYPES: list[dict[str, Any]] = [
    # ── Movers ─────────────────────────────────────────────────
    {
        "code": "TOP_PERC_GAIN",
        "display_name": "Top % Gainers",
        "category": "movers",
        "popular": True,
    },
    {
        "code": "TOP_PERC_LOSE",
        "display_name": "Top % Losers",
        "category": "movers",
        "popular": True,
    },
    {
        "code": "MOST_ACTIVE",
        "display_name": "Most Active (Shares)",
        "category": "movers",
        "popular": True,
    },
    {
        "code": "HOT_BY_VOLUME",
        "display_name": "Hot by Volume",
        "category": "movers",
        "popular": True,
    },
    {
        "code": "MOST_ACTIVE_USD",
        "display_name": "Most Active (Dollar Volume)",
        "category": "movers",
    },
    {
        "code": "TOP_TRADE_COUNT",
        "display_name": "Top Trade Count",
        "category": "movers",
        "subtitle": "Number of trades — buzz / retail attention",
    },
    {
        "code": "HIGH_STVOLUME_5MIN",
        "display_name": "High 5-Minute Volume",
        "category": "movers",
        "subtitle": "Intraday volume spikes (last 5 min)",
    },

    # ── Highs & Lows ───────────────────────────────────────────
    {
        "code": "HIGH_VS_52W_HL",
        "display_name": "52-Week Highs",
        "category": "highs_lows",
        "popular": True,
    },
    {
        "code": "LOW_VS_52W_HL",
        "display_name": "52-Week Lows",
        "category": "highs_lows",
        "popular": True,
    },
    {
        "code": "HIGH_VS_13W_HL",
        "display_name": "13-Week Highs",
        "category": "highs_lows",
    },
    {
        "code": "LOW_VS_13W_HL",
        "display_name": "13-Week Lows",
        "category": "highs_lows",
    },

    # ── Pre / Post Market ──────────────────────────────────────
    {
        "code": "TOP_OPEN_PERC_GAIN",
        "display_name": "Pre-Market Gainers",
        "category": "pre_post_market",
        "subtitle": _PREMARKET,
    },
    {
        "code": "TOP_OPEN_PERC_LOSE",
        "display_name": "Pre-Market Losers",
        "category": "pre_post_market",
        "subtitle": _PREMARKET,
    },
    {
        "code": "TOP_AFTER_HOURS_PERC_GAIN",
        "display_name": "After-Hours Gainers",
        "category": "pre_post_market",
        "subtitle": _AFTERHOURS,
    },
    {
        "code": "TOP_AFTER_HOURS_PERC_LOSE",
        "display_name": "After-Hours Losers",
        "category": "pre_post_market",
        "subtitle": _AFTERHOURS,
    },

    # ── Gaps ───────────────────────────────────────────────────
    {
        "code": "HIGH_OPEN_GAP",
        "display_name": "Top Gap Up (Close→Open)",
        "category": "gaps",
    },
    {
        "code": "LOW_OPEN_GAP",
        "display_name": "Top Gap Down (Close→Open)",
        "category": "gaps",
    },

    # ── Options & Vol ──────────────────────────────────────────
    {
        "code": "HIGH_OPT_IMP_VOLAT",
        "display_name": "High Implied Vol",
        "category": "options_vol",
        "subtitle": _OPTIONS_HOSTS,
    },
    {
        "code": "LOW_OPT_IMP_VOLAT",
        "display_name": "Low Implied Vol",
        "category": "options_vol",
        "subtitle": _OPTIONS_HOSTS,
    },
    {
        "code": "TOP_OPT_IMP_VOLAT_GAIN",
        "display_name": "Top IV % Gainers",
        "category": "options_vol",
        "subtitle": "IV expansion — earnings setup",
    },
    {
        "code": "TOP_OPT_IMP_VOLAT_LOSE",
        "display_name": "Top IV % Losers",
        "category": "options_vol",
        "subtitle": "IV crush — post-earnings",
    },
    {
        "code": "OPT_VOLUME_MOST_ACTIVE",
        "display_name": "Top Options Volume",
        "category": "options_vol",
    },

    # ── Fundamentals ───────────────────────────────────────────
    {
        "code": "HIGH_DIVIDEND_YIELD_IB",
        "display_name": "High Dividend Yield",
        "category": "fundamentals",
    },
    {
        "code": "HIGH_GROWTH_RATE",
        "display_name": "High Growth Rate",
        "category": "fundamentals",
    },

    # ── Special Situations ─────────────────────────────────────
    {
        "code": "HALTED",
        "display_name": "Halted Stocks",
        "category": "special",
        "subtitle": "Currently or recently halted",
    },
    {
        "code": "FIRST_TRADE_DATE_ASC",
        "display_name": "Upcoming IPOs",
        "category": "special",
        "subtitle": "Sorted by next first-trade date",
    },
]

# Lookup helpers — used by the screener service to look up category /
# subtitle / popular-flag without re-walking the list.
SCAN_TYPE_BY_CODE: dict[str, dict[str, Any]] = {
    s["code"]: s for s in CURATED_SCAN_TYPES
}

# Display labels for the category groups. Frontend uses this to render
# section headers in both the preset dropdown's "More screens" optgroup
# and the Browse all scans panel.
CATEGORY_LABELS: dict[str, str] = {
    "movers": "Movers",
    "highs_lows": "Highs & Lows",
    "pre_post_market": "Pre / Post Market",
    "gaps": "Gaps",
    "options_vol": "Options & Volatility",
    "fundamentals": "Fundamentals",
    "special": "Special Situations",
    "etfs": "ETFs",
}

# Ordered list of categories for stable section ordering in the UI.
CATEGORY_ORDER: list[str] = [
    "movers",
    "highs_lows",
    "pre_post_market",
    "gaps",
    "options_vol",
    "fundamentals",
    "special",
    "etfs",
]

# Scan types where IBKR returns rows that have NO snapshot quote data —
# the conids haven't started trading yet (IPOs) or are in some pre-trade
# state. For these we must:
#   1. Skip snapshot batching entirely (saves 5-10s of doomed API calls)
#   2. Skip the "drop ticker-only" filter (otherwise every row is dropped)
#
# The scan_data field on the row carries the meaningful info instead
# (e.g. "First trade: 2026-05-12") and the table renders it in place
# of the empty price column.
NO_QUOTE_SCAN_TYPES: frozenset[str] = frozenset({
    "FIRST_TRADE_DATE_ASC",
})
