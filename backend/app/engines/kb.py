"""Cached, read-only access to the knowledge-base JSON (mirrored into SQLite by seed.py)."""
import json
from functools import lru_cache

from ..config import DATA_DIR


@lru_cache
def _load(name: str):
    return json.loads((DATA_DIR / name).read_text())


def waste_kb(industry_type: str | None = None) -> list[dict]:
    rows = _load("waste_kb.json")
    return [r for r in rows if industry_type is None or r["industry_type"] == industry_type]


def demand_kb(industry_type: str | None = None) -> list[dict]:
    rows = _load("demand_kb.json")
    return [r for r in rows if industry_type is None or r["industry_type"] == industry_type]


def processing() -> list[dict]:
    return _load("processing.json")


def regulations() -> dict:
    return _load("regulations.json")


@lru_cache
def waste_vocabulary() -> list[str]:
    names = {r["waste_name"] for r in waste_kb()}
    for d in demand_kb():
        names.update(d["accepted_substitutes"])
    return sorted(names)


def waste_template(name: str) -> dict | None:
    """First KB entry for a waste name (any industry type) - used for composition/category defaults."""
    return next((r for r in waste_kb() if r["waste_name"] == name), None)


def industry_types() -> list[str]:
    return sorted({r["industry_type"] for r in waste_kb()} | {r["industry_type"] for r in demand_kb()})
