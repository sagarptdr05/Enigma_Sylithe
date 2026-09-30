"""Thin Anthropic wrapper. Every function degrades to [] / None when no key or on any failure."""
import json
import logging
import re

from .. import config
from .prompts import EXPLAIN_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, extraction_user_prompt

log = logging.getLogger("sylithex.llm")
_client = None


def available() -> bool:
    return bool(config.ANTHROPIC_API_KEY)


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY, timeout=30.0, max_retries=1)
    return _client


def _complete(system: str, user: str, max_tokens: int = 2000) -> str | None:
    if not available():
        return None
    try:
        resp = _get_client().messages.create(
            model=config.LLM_MODEL, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
    except Exception as exc:  # network, auth, rate limit...
        log.warning("LLM call failed: %s", exc)
        return None


def strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _complete_json(system: str, user: str):
    for _ in range(2):  # one retry
        raw = _complete(system, user)
        if raw is None:
            return None
        try:
            return json.loads(strip_fences(raw))
        except json.JSONDecodeError:
            m = re.search(r"\[.*\]", raw, re.S)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    pass
    return None


def extract_byproducts(industry_type: str, capacity: float, unit: str, text: str) -> list[dict]:
    if not text or not available():
        return []
    data = _complete_json(EXTRACTION_SYSTEM_PROMPT, extraction_user_prompt(industry_type, capacity, unit, text))
    if not isinstance(data, list):
        return []
    return [d for d in data if isinstance(d, dict) and d.get("waste_name")]


def explain(payload: dict) -> str | None:
    out = _complete(EXPLAIN_SYSTEM_PROMPT, json.dumps(payload, default=str), max_tokens=400)
    return out or None
