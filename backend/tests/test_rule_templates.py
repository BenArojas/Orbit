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
async def test_each_builtin_has_valid_conditions_json(db: DatabaseService) -> None:
    await seed_builtin_templates(db)
    rows = await db.fetch_all("SELECT name, conditions_json FROM rule_templates WHERE is_builtin=1")
    for r in rows:
        data = json.loads(r["conditions_json"])
        assert isinstance(data, list) and len(data) >= 1
        for cond in data:
            assert "indicator" in cond
            assert "condition" in cond
