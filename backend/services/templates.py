"""
Built-in rule templates seeded on app boot.

Each template prefills a multi-condition trigger rule. The user
picks a template in the rule modal, tunes thresholds + watchlist,
and saves. Custom user-saved templates also live in rule_templates
with is_builtin=0.
"""
import json
import logging
from typing import Final

from services.db import DatabaseService

log = logging.getLogger("parallax.templates")


BUILTIN_TEMPLATES: Final[list[dict]] = [
    {
        "name": "High Volume Pullback",
        "description": "RSI <35 while trend stays above EMA 200, with elevated volume.",
        "category": "mean_reversion",
        "default_timeframe": "1D",
        "conditions": [
            {"indicator": "rsi",        "condition": "below",         "threshold": 35.0},
            {"indicator": "ema_200",    "condition": "above",         "threshold": 0.0},
            {"indicator": "volume",     "condition": "above",         "threshold": 1.2},   # multiplier of 20-bar avg
        ],
    },
    {
        "name": "Mean Reversion",
        "description": "RSI oversold while still above the 200 EMA.",
        "category": "mean_reversion",
        "default_timeframe": "1D",
        "conditions": [
            {"indicator": "rsi",     "condition": "below", "threshold": 30.0},
            {"indicator": "ema_200", "condition": "above", "threshold": 0.0},
        ],
    },
    {
        "name": "Trend Pullback to 21EMA",
        "description": "Low touches 21 EMA in a confirmed uptrend.",
        "category": "momentum",
        "default_timeframe": "1D",
        "conditions": [
            {"indicator": "ema_21",  "condition": "crosses_below", "threshold": 0.0},
            {"indicator": "ema_50",  "condition": "above",         "threshold": 0.0},
            {"indicator": "ema_200", "condition": "above",         "threshold": 0.0},
        ],
    },
    {
        "name": "Breakout + Volume",
        "description": "Price crosses above the 21 EMA with confirming volume.",
        "category": "breakout",
        "default_timeframe": "1D",
        "conditions": [
            {"indicator": "ema_21",  "condition": "crosses_above", "threshold": 0.0},
            {"indicator": "volume",  "condition": "above",          "threshold": 1.5},
        ],
    },
    {
        "name": "Earnings Gap Reaction",
        "description": "News candle gap with confirming volume.",
        "category": "news",
        "default_timeframe": "1D",
        "conditions": [
            {"indicator": "news_candle", "condition": "fires", "threshold": 2.0,
             "news_candle_method": "gap"},
            {"indicator": "volume",      "condition": "above", "threshold": 1.5},
        ],
    },
    {
        "name": "Oversold Bounce",
        "description": "RSI crosses back above 30 while above the 50 EMA.",
        "category": "mean_reversion",
        "default_timeframe": "1D",
        "conditions": [
            {"indicator": "rsi",    "condition": "crosses_above", "threshold": 30.0},
            {"indicator": "ema_50", "condition": "above",         "threshold": 0.0},
        ],
    },
]


async def seed_builtin_templates(db: DatabaseService) -> None:
    """Idempotently seed BUILTIN_TEMPLATES into rule_templates."""
    names = tuple(tpl["name"] for tpl in BUILTIN_TEMPLATES)
    placeholders = ",".join("?" for _ in names)
    await db.execute(
        f"DELETE FROM rule_templates WHERE is_builtin=1 AND name NOT IN ({placeholders})",
        names,
    )
    for tpl in BUILTIN_TEMPLATES:
        await db.execute(
            """
            INSERT OR IGNORE INTO rule_templates
                (name, description, category, is_builtin, default_timeframe, conditions_json)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            (
                tpl["name"],
                tpl["description"],
                tpl["category"],
                tpl["default_timeframe"],
                json.dumps(tpl["conditions"]),
            ),
        )
        await db.execute(
            """
            UPDATE rule_templates
            SET description=?, category=?, default_timeframe=?, conditions_json=?
            WHERE name=? AND is_builtin=1
            """,
            (
                tpl["description"],
                tpl["category"],
                tpl["default_timeframe"],
                json.dumps(tpl["conditions"]),
                tpl["name"],
            ),
        )
    log.info("Seeded %d built-in rule templates", len(BUILTIN_TEMPLATES))
