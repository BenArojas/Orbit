"""
Curated scanner locations for the Parallax Location dropdown.

IBKR's scanner API requires the right `instrument` code paired with each
`location` code — they're not independent. The top-level instrument groups
in IBKR's location_tree are:
    STK         → US Major (Listed/NASDAQ) + US Minor (OTC)
    STOCK.NA    → Canada, Mexico
    STOCK.EU    → UK, Germany, France, Switzerland, Netherlands, Italy, ...
    STOCK.HK    → Japan, Hong Kong, Australia, Singapore, India, ...
    STOCK.ME    → Israel, Saudi Arabia, UAE
    ETF.EQ.US   → US Equity ETFs
    ETF.FI.US   → US Fixed Income ETFs
    FUT.US      → US Futures (CME, CBOT, NYMEX, ...)

Sending `instrument=STK` with `location=STK.HK.TSE_JPN` (Japan) gives IBKR
500 "No matching locations defined" — the location must be under STOCK.HK.

Each entry below carries the instrument it pairs with so the scan request
can use the right pair regardless of what preset the user picked.

Codes are grep-verified against `backend/ibkr_scanner_params.json` (a
snapshot of /iserver/scanner/params). Add markets here as needed — keep
the list curated; the full IBKR list is exposed via the Browse all scans
panel.
"""

from typing import Any

CURATED_LOCATIONS: list[dict[str, Any]] = [
    # ── United States ──────────────────────────────────────────
    {
        "instrument": "STK",
        "location": "STK.US.MAJOR",
        "label": "US — Listed/NASDAQ",
    },
    {
        "instrument": "STK",
        "location": "STK.US.MINOR",
        "label": "US — OTC Markets",
    },

    # ── North America (non-US) ─────────────────────────────────
    {
        "instrument": "STOCK.NA",
        "location": "STK.NA.CANADA",
        "label": "Canada",
    },

    # ── Europe ─────────────────────────────────────────────────
    {
        "instrument": "STOCK.EU",
        "location": "STK.EU.LSE",
        "label": "UK — LSE",
    },
    {
        "instrument": "STOCK.EU",
        "location": "STK.EU.IBIS",
        "label": "Germany — Xetra",
    },
    {
        "instrument": "STOCK.EU",
        "location": "STK.EU.SBF",
        "label": "France",
    },
    {
        "instrument": "STOCK.EU",
        "location": "STK.EU.EBS",
        "label": "Switzerland",
    },
    {
        "instrument": "STOCK.EU",
        "location": "STK.EU.AEB",
        "label": "Netherlands",
    },

    # ── Asia / Pacific ─────────────────────────────────────────
    {
        "instrument": "STOCK.HK",
        "location": "STK.HK.TSE_JPN",
        "label": "Japan",
    },
    {
        "instrument": "STOCK.HK",
        "location": "STK.HK.SEHK",
        "label": "Hong Kong",
    },
    {
        "instrument": "STOCK.HK",
        "location": "STK.HK.ASX",
        "label": "Australia",
    },
    {
        "instrument": "STOCK.HK",
        "location": "STK.HK.SGX",
        "label": "Singapore",
    },
    {
        "instrument": "STOCK.HK",
        "location": "STK.HK.NSE",
        "label": "India",
    },
]

# Lookup helper — given a location code, return the curated entry
# (or None if the user is using a location not in our curated list,
# e.g. a Browse-all-scans pick that bundles its own location).
LOCATION_BY_CODE: dict[str, dict[str, Any]] = {
    loc["location"]: loc for loc in CURATED_LOCATIONS
}

# The default location code shown in the dropdown on first load and
# whenever the location is "reset" (e.g. by the Browse panel after an
# incompatible pick). Single source of truth — no more "Preset default"
# entry that hides which location actually runs.
DEFAULT_LOCATION_CODE: str = "STK.US.MAJOR"
