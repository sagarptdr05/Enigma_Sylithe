"""Property-based matching: parameter-independent candidate pairs (waste stream x demand)."""
import math

from . import kb
from .distance import road_km
from .similarity import canonical_name, similarity

MIN_TECH_FIT = 0.4
SIM_THRESHOLD = 0.75
MAX_ENERGY_KM = 20  # heat / gas networks are only viable over short distances
_canon_cache: dict[str, str] = {}


def canonical(name: str) -> str:
    if name not in _canon_cache:
        _canon_cache[name] = canonical_name(name, kb.waste_vocabulary(), SIM_THRESHOLD)
    return _canon_cache[name]


def is_compatible(waste_name: str, accepted: list[str]) -> bool:
    name = canonical(waste_name)
    if name in accepted:
        return True
    return any(similarity(name, a) >= SIM_THRESHOLD for a in accepted) if name not in kb.waste_vocabulary() else False


def property_fit(value: float | None, lo: float, hi: float) -> float:
    if value is None:
        return 0.5  # unknown property: neutral
    if lo <= value <= hi:
        return 1.0
    bound = lo if value < lo else hi
    rel = abs(value - bound) / max(abs(bound), 1.0)
    return math.exp(-3 * rel)


def technical_fit(composition: dict, spec: dict) -> tuple[float, list[dict]]:
    if not spec:
        return 1.0, []
    rows = []
    for prop, (lo, hi) in spec.items():
        v = composition.get(prop)
        f = property_fit(v, lo, hi)
        rows.append({"property": prop, "actual": v, "min": lo, "max": hi, "fit": round(f, 3), "ok": f >= 0.999})
    return sum(r["fit"] for r in rows) / len(rows), rows


def timing(supply: list[float], demand: list[float]) -> float:
    total = sum(demand)
    if total <= 0:
        return 0.0
    return sum(min(s, d) for s, d in zip(supply, demand)) / total


def processing_steps(waste: str, material: str, composition: dict | None = None) -> list[dict]:
    if waste == "CO2 off-gas":
        # capture cost depends on concentration: dilute flue gas needs amine capture, fermentation CO2 is ~pure
        if (composition or {}).get("CO2_pct", 100) < 50:
            return [{"step": "Amine-based capture from flue gas", "cost_per_tonne": 3800},
                    {"step": "Compression & purification", "cost_per_tonne": 900}]
        return [{"step": "Scrubbing, compression & purification", "cost_per_tonne": 1100}]
    rows = kb.processing()
    hit = next((r for r in rows if r["waste_name"] == waste and r["raw_material"] == material), None)
    hit = hit or next((r for r in rows if r["waste_name"] == waste and r["raw_material"] == "*"), None)
    return hit["steps"] if hit else []


def regulatory_flags(waste: str, hazardous: bool) -> list[str]:
    if not hazardous:
        return []
    reg = kb.regulations()
    cat = reg["waste_map"].get(waste)
    if cat is None:
        return ["MPCB authorisation under Rule 6", "Rule 9 utilisation permission", "Manifest system for transport (Form 10)"]
    return list(reg["categories"][cat]["permissions"])


def own_wastes(industry_type: str) -> set[str]:
    return {r["waste_name"] for r in kb.waste_kb(industry_type)}


def candidate(ws: dict, dm: dict, src: dict, dst: dict) -> dict | None:
    if ws["industry_id"] == dm["industry_id"] or not is_compatible(ws["waste_name"], dm["accepted_substitutes"]):
        return None
    fit, rows = technical_fit(ws["composition"] or {}, dm["spec"] or {})
    if fit < MIN_TECH_FIT:
        return None
    name = canonical(ws["waste_name"])
    if ws["category"] == "energy" and name in own_wastes(dst["type"]):
        return None  # buyer recovers its own heat/gas first
    dist = road_km(src["lat"], src["lon"], dst["lat"], dst["lon"])
    if ws["category"] == "energy" and dist > MAX_ENERGY_KM:
        return None
    steps = processing_steps(name, dm["material"], ws["composition"])
    return dict(
        waste_stream_id=ws["id"], demand_id=dm["id"], src_id=src["id"], dst_id=dst["id"],
        src_cluster=src["cluster"], dst_cluster=dst["cluster"], waste_name=ws["waste_name"], material=dm["material"],
        category=ws["category"], supply=ws["monthly_tonnes"], demand=dm["monthly_tonnes"],
        virgin_price=dm["virgin_price"], virgin_co2=dm["virgin_co2"], disposal=ws.get("disposal_cost_per_tonne", 0) or 0,
        technical_fit=fit, property_rows=rows, distance_km=dist,
        timing=timing(ws["seasonality"], dm["seasonality"]),
        processing_steps=steps, processing_cost=sum(s["cost_per_tonne"] for s in steps),
        hazardous=ws["hazardous"], regulatory_flags=regulatory_flags(name, ws["hazardous"]),
    )


def find_candidates(streams: list[dict], demands: list[dict], industries: dict[int, dict]) -> list[dict]:
    out = []
    for ws in streams:
        for dm in demands:
            c = candidate(ws, dm, industries[ws["industry_id"]], industries[dm["industry_id"]])
            if c:
                out.append(c)
    return out
