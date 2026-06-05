import json

import pytest

from services.db import DatabaseService
from services.templates import BUILTIN_TEMPLATES, seed_builtin_templates


@pytest.fixture
async def db(tmp_path):
    svc = DatabaseService(db_path=str(tmp_path / "t.db"))
    await svc.connect()
    yield svc
    await svc.close()


@pytest.mark.asyncio
async def test_seeds_all_builtins_on_first_run(db: DatabaseService) -> None:
    await seed_builtin_templates(db)
    rows = await db.fetch_all("SELECT name, category FROM rule_templates WHERE is_builtin=1")
    names = {r["name"] for r in rows}
    assert names == {t["name"] for t in BUILTIN_TEMPLATES}


@pytest.mark.asyncio
async def test_seeding_is_idempotent(db: DatabaseService) -> None:
    await seed_builtin_templates(db)
    await seed_builtin_templates(db)  # second call must not duplicate
    rows = await db.fetch_all("SELECT COUNT(*) AS n FROM rule_templates WHERE is_builtin=1")
    assert rows[0]["n"] == len(BUILTIN_TEMPLATES)


@pytest.mark.asyncio
async def test_seeding_removes_retired_builtin_templates(db: DatabaseService) -> None:
    await db.execute(
        """
        INSERT INTO rule_templates
            (name, description, category, is_builtin, default_timeframe, conditions_json)
        VALUES ('Retired Fib Template', NULL, 'fibonacci', 1, '1D', '[]')
        """
    )

    await seed_builtin_templates(db)

    rows = await db.fetch_all(
        "SELECT name FROM rule_templates WHERE name='Retired Fib Template'"
    )
    assert rows == []


@pytest.mark.asyncio
async def test_each_builtin_has_valid_conditions_json(db: DatabaseService) -> None:
    await seed_builtin_templates(db)
    rows = await db.fetch_all("SELECT name, conditions_json FROM rule_templates WHERE is_builtin=1")
    for r in rows:
        data = json.loads(r["conditions_json"])
        assert isinstance(data, list) and len(data) >= 1
        for cond in data:
            assert "indicator" in cond
            assert "condition" in cond


def test_builtin_rule_templates_only_use_supported_generic_indicators():
    supported = {
        "rsi",
        "macd",
        "ema_9",
        "ema_21",
        "ema_50",
        "ema_200",
        "volume",
        "bbands",
        "vwap",
        "atr",
        "stoch",
        "obv",
        "adx",
        "news_candle",
    }

    indicators = {
        condition["indicator"]
        for template in BUILTIN_TEMPLATES
        for condition in template["conditions"]
    }

    assert "ema_20" not in indicators
    assert "fibonacci" not in indicators
    assert indicators <= supported


def test_news_candle_templates_use_valid_news_condition_shape():
    news_conditions = [
        condition
        for template in BUILTIN_TEMPLATES
        for condition in template["conditions"]
        if condition["indicator"] == "news_candle"
    ]

    assert news_conditions
    for condition in news_conditions:
        assert condition["condition"] == "fires"
        assert condition["news_candle_method"] in {
            "volume_spike",
            "range_spike",
            "gap",
            "long_wick",
        }
