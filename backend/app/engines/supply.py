"""Supply assurance: coverage, shortfall, freshness, reliability and capacity-safe allocation."""
from datetime import datetime, timezone
from statistics import mean, pstdev

STALE_DAYS = 90


def coverage(demand: float, available: float) -> dict:
    if not demand:
        return {"coverage_pct": None, "shortfall": None}
    return {"coverage_pct": round(min(available / demand, 1) * 100, 1), "shortfall": round(max(0.0, demand - available), 1)}


def freshness(updated_at: str | None, now: datetime | None = None) -> dict:
    if not updated_at:
        return {"status": "never_confirmed", "days": None, "label": "Availability never confirmed by the company"}
    now = now or datetime.now(timezone.utc)
    days = (now - datetime.fromisoformat(updated_at)).days
    if days > STALE_DAYS:
        return {"status": "stale", "days": days, "label": f"Last confirmed {days} days ago: ask the supplier to refresh"}
    return {"status": "fresh", "days": days, "label": f"Confirmed {days} day{'s' if days != 1 else ''} ago"}


def reliability_from_deliveries(deliveries: list[dict]) -> dict:
    """deliveries: [{dispatched, received, accepted, on_time}] recorded on the platform (real, not demo)."""
    ot = [d["on_time"] for d in deliveries if d["on_time"] is not None]
    on_time = sum(ot) / len(ot) if ot else None
    fill = sum(min(d["received"] / d["dispatched"], 1) for d in deliveries if d["dispatched"]) / len(deliveries)
    acc = [d["accepted"] / d["received"] for d in deliveries if d["received"] and d["accepted"] is not None]
    acceptance = sum(acc) / len(acc) if acc else None
    level = ("high" if (on_time is None or on_time >= 0.9) and fill >= 0.95 and (acceptance or 1) >= 0.95 else
             "medium" if (on_time is None or on_time >= 0.75) and fill >= 0.85 else "low")
    return {"level": level, "label": {"high": "Reliable", "medium": "Mostly reliable", "low": "Unreliable"}[level] + f" ({len(deliveries)} platform deliveries)",
            "on_time_pct": round(on_time * 100, 1) if on_time is not None else None, "fill_rate_pct": round(fill * 100, 1),
            "acceptance_pct": round(acceptance * 100, 1) if acceptance is not None else None, "months": None, "variability": None,
            "demo_data": False, "basis": "platform"}


def reliability(records: list, deliveries: list[dict] | None = None) -> dict:
    """Platform deliveries first; otherwise supplier-reported / demo monthly history.
    No history -> 'not established' (never a favourable default)."""
    if deliveries:
        return reliability_from_deliveries(deliveries)
    deliveries = [r for r in records if r.delivered_tonnes is not None and r.committed_tonnes]
    avail = [r.available_tonnes for r in records]
    variability = round(pstdev(avail) / mean(avail), 3) if len(avail) >= 3 and mean(avail) > 0 else None
    demo = any(r.source == "demo" for r in records)
    if not deliveries:
        return {"level": "not_established", "label": "Reliability not established", "on_time_pct": None, "fill_rate_pct": None,
                "months": len(records), "variability": variability, "demo_data": demo, "basis": None}
    on_time = [r.on_time for r in deliveries if r.on_time is not None]
    ot = sum(on_time) / len(on_time) if on_time else None
    fill = sum(min(r.delivered_tonnes / r.committed_tonnes, 1) for r in deliveries) / len(deliveries)
    level = "high" if (ot or 0) >= 0.9 and fill >= 0.95 else "medium" if (ot or 0) >= 0.75 and fill >= 0.85 else "low"
    return {"level": level, "label": {"high": "Reliable", "medium": "Mostly reliable", "low": "Unreliable"}[level] + f" ({len(deliveries)} deliveries)",
            "on_time_pct": round(ot * 100, 1) if ot is not None else None, "fill_rate_pct": round(fill * 100, 1), "months": len(records),
            "variability": variability, "demo_data": demo, "basis": "demo" if demo else "reported"}


def allocate(demand: float, options: list[dict]) -> dict:
    """Greedy allocation by cost per usable tonne, qualified sources first. Never exceeds any capacity.
    option: {id, capacity, cost, eligible, qualified}"""
    remaining = demand
    plan = []
    for o in sorted([o for o in options if o["eligible"] and o["capacity"] > 0], key=lambda o: (not o["qualified"], o["cost"] if o["cost"] is not None else 1e12)):
        if remaining <= 1e-9:
            break
        take = min(o["capacity"], remaining)
        plan.append({"id": o["id"], "tonnes": round(take, 1), "qualified": o["qualified"]})
        remaining -= take
    return {"plan": plan, "covered": round(demand - remaining, 1), "uncovered": round(max(remaining, 0), 1),
            "coverage_pct": round((demand - max(remaining, 0)) / demand * 100, 1) if demand else None,
            "single_source_risk": sum(1 for o in options if o["eligible"] and o["qualified"]) <= 1}
