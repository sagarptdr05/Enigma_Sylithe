"""Discover Alternatives: from an intended use + current material to ranked, gated waste alternatives.

Pipeline (cheap -> expensive): semantic application match -> candidate materials (substitute list,
property overlap, name similarity) -> streams in range -> property / quantity / distance / processing /
regulatory / evidence / economics gates -> ranking by feasibility, not by similarity."""
from collections import defaultdict

from sqlalchemy.orm import Session

from . import kb, scoring
from .assessment import assess, plabel
from .costing import CostInputs, landed_cost, processing_yield
from .routes import find_routes
from .supply import allocate, freshness
from .distance import road_km
from .matching import canonical, processing_steps, regulatory_flags
from .similarity import similarity
from ..models import Evidence, Industry, WasteStream

TYPE_LABEL = {"steel": "steel making", "cement": "cement production", "thermal_power": "thermal power generation",
              "sugar_mill": "sugar manufacturing", "distillery": "ethanol distillation", "paper_mill": "paper making",
              "brick_kiln": "brick making", "fertilizer_phosphate": "fertilizer production", "chemical": "chemical manufacturing",
              "data_centre": "data centre operations", "food_processing": "food processing", "auto_components": "auto component manufacturing",
              "greenhouse": "greenhouse farming", "biogas_plant": "biogas production"}


def evidence_by_stream(db: Session, ids: list[int]) -> dict[int, list]:
    out = defaultdict(list)
    if ids:
        for e in db.query(Evidence).filter(Evidence.waste_stream_id.in_(ids)).all():
            out[e.waste_stream_id].append(e)
    return out


def match_applications(intended_use: str, current_material: str, limit: int = 2) -> list[dict]:
    """Which (industry type, raw material) profiles does the request describe?"""
    scored = []
    for row in kb.demand_kb():
        s_mat = similarity(current_material, row["raw_material"]) if current_material else 0
        use = TYPE_LABEL.get(row["industry_type"], row["industry_type"])
        s_use = max(similarity(intended_use, use), similarity(intended_use, f"{row['raw_material']} for {use}")) if intended_use else 0
        score = 0.6 * s_mat + 0.4 * s_use if current_material and intended_use else max(s_mat, s_use)
        scored.append((score, row))
    scored.sort(key=lambda x: -x[0])
    top = scored[0][0]
    # only profiles about as relevant as the best one: every candidate is judged against ONE spec
    picked = [(s, r) for s, r in scored if s >= 0.5 and s >= top - 0.08 and r["required_spec"] == scored[0][1]["required_spec"]][:limit] or [scored[0]]
    return [{**r, "match_score": round(s, 3)} for s, r in picked]


def candidate_materials(apps: list[dict], spec: dict, current_material: str) -> dict[str, list[str]]:
    """material -> reasons it was considered (the discovery route is shown to the user)."""
    routes: dict[str, list[str]] = defaultdict(list)
    for a in apps:
        for w in a["accepted_substitutes"]:
            routes[w].append(f"it is listed as an accepted substitute for {a['raw_material']} in {TYPE_LABEL.get(a['industry_type'], a['industry_type'])}")
    props = [p for p in spec if p != "temperature_C"]
    seen = set()
    for tpl in kb.waste_kb():
        name = tpl["waste_name"]
        if name in seen:
            continue
        seen.add(name)
        comp = tpl["composition"]
        known = [p for p in props if p in comp]
        if len(known) >= 2 and all(spec[p][0] <= comp[p] <= spec[p][1] for p in known):
            routes[name].append("its typical composition overlaps the required specification (" + ", ".join(plabel(p) for p in known) + ")")
        if current_material and similarity(current_material, name) >= 0.6:
            routes[name].append(f"its name/chemistry is close to {current_material}")
    return routes


def discover(db: Session, *, intended_use: str, current_material: str, monthly_tonnes: float, lat: float, lon: float,
             max_distance: float = 150, current_price: float | None = None, required_spec: dict | None = None,
             exclude_industry: int | None = None, params: scoring.Params | None = None) -> dict:
    apps = match_applications(intended_use, current_material)
    primary = apps[0]
    spec = {**primary["required_spec"], **(required_spec or {})}
    price = current_price if current_price else primary["virgin_price_per_tonne"]
    price_src = "USER PROVIDED" if current_price else "ESTIMATE"
    p = params or scoring.Params()
    p = scoring.Params(**{**p.__dict__, "max_distance": max_distance})
    routes = candidate_materials(apps, spec, current_material)

    streams = db.query(WasteStream).filter(WasteStream.waste_name.in_(list(routes))).all()
    streams = [s for s in streams if s.industry_id != exclude_industry]
    inds = {i.id: i for i in db.query(Industry).all()}
    ev = evidence_by_stream(db, [s.id for s in streams])
    grouped = defaultdict(list)
    for s in streams:
        ind = inds[s.industry_id]
        dist = road_km(lat, lon, ind.lat, ind.lon)
        if dist > max_distance * 2.5:  # cheap pre-filter before the full assessment
            continue
        name = canonical(s.waste_name)
        steps = processing_steps(name, primary["raw_material"], s.composition)
        a = assess(ws=s, evidence=ev[s.id], spec=spec, material=primary["raw_material"], need_tonnes=monthly_tonnes,
                   virgin_price=price, virgin_co2=primary["virgin_co2_per_tonne"], distance_km=dist,
                   processing_steps=steps, regulatory_flags=regulatory_flags(name, s.hazardous), params=p, price_source=price_src)
        grouped[s.waste_name].append({
            "waste_stream_id": s.id, "industry": {"id": ind.id, "name": ind.name, "type": ind.type, "cluster": ind.cluster,
                                                  "lat": ind.lat, "lon": ind.lon, "address": ind.address},
            "monthly_tonnes": s.monthly_tonnes, "trust": s.verification_status, "source": s.source, "confidence": s.confidence,
            "hazardous": s.hazardous, **{k: a[k] for k in ("distance_km", "coverage", "technical_fit", "gates", "viable", "readiness",
                                                           "why_match", "concerns", "properties", "evidence", "unit")},
            "combined_per_year_estimate": a["economics"]["combined_per_year_estimate"],
            "landed_cost_per_usable_tonne": landed_cost(CostInputs(
                material_price=round(price * 0.35), material_price_basis="ESTIMATE", distance_km=dist, transport_rate=p.transport_rate,
                diesel_multiplier=p.diesel_multiplier, processing=sum(x["cost_per_tonne"] for x in steps) * p.processing_multiplier,
                monthly_tonnes=min(s.monthly_tonnes, monthly_tonnes), processing_yield=processing_yield(steps), baseline_price=price * p.virgin_price_multiplier,
            ))["cost_per_usable_tonne"],
            "freshness": freshness(s.availability_updated_at), "min_order": s.min_order_tonnes,
            "combined_per_unit": a["economics"]["combined_per_unit"], "co2_per_year_estimate": a["economics"]["co2_per_year_estimate"],
        })

    def rank_key(x):
        warns = sum(1 for g in x["gates"] if g["status"] == "warn")
        return (not x["viable"], warns, -x["combined_per_year_estimate"])

    alternatives = []
    for material, reasons in routes.items():
        items = sorted(grouped.get(material, []), key=rank_key)
        feasible = [i for i in items if i["viable"]]
        best = feasible[0] if feasible else (items[0] if items else None)
        tpl = next((r for r in kb.waste_kb() if r["waste_name"] == material), None)
        why = f"{material} was identified because " + "; ".join(dict.fromkeys(reasons)) + "."
        if best and best["readiness"]["blockers"]:
            prio = ["technical", "regulatory", "quantity", "economics", "distance", "evidence", "processing", "timing"]
            b = sorted(best["readiness"]["blockers"], key=lambda b: prio.index(b["gate"]))[0]
            why += f" However, {b['text'][0].lower() + b['text'][1:]}. Next step: {b['action'][0].lower() + b['action'][1:]}."
        if not items:
            why += " No plant generating it was found within range."
        alternatives.append({
            "material": material, "category": tpl["category"] if tpl else None, "hazardous": bool(tpl and tpl["hazardous"]),
            "routes": list(dict.fromkeys(reasons)), "explanation": why,
            "status": "feasible" if feasible else ("not_feasible" if items else "no_supply"),
            "feasible_count": len(feasible), "total_count": len(items),
            "best_value_per_year": best["combined_per_year_estimate"] if best and best["viable"] else 0,
            "streams": items[:6],
            "why_not": sorted({c for i in items if not i["viable"] for c in i["concerns"] if c.startswith("✗")})[:5],
        })
    order = {"feasible": 0, "not_feasible": 1, "no_supply": 2}
    alternatives.sort(key=lambda a: (order[a["status"]], -a["best_value_per_year"]))
    pool = [st for items in grouped.values() for st in items if st["viable"]]
    plan = allocate(monthly_tonnes, [{"id": st["waste_stream_id"], "capacity": st["monthly_tonnes"], "cost": st["landed_cost_per_usable_tonne"],
                                      "eligible": True, "qualified": st["trust"] in ("user_declared", "verified") and st["evidence"]["completeness"] >= 0.6}
                                     for st in pool])
    names = {st["waste_stream_id"]: (st["industry"], st["material"] if "material" in st else None) for st in pool}
    for row in plan["plan"]:
        row["industry"], _ = names[row["id"]]
    routes = find_routes(db, material=primary["raw_material"], spec=spec, accepted=primary["accepted_substitutes"], lat=lat, lon=lon,
                         need=monthly_tonnes, baseline_price=price * p.virgin_price_multiplier, virgin_co2=primary["virgin_co2_per_tonne"],
                         exclude_industry=exclude_industry, max_leg_km=max_distance, transport_rate=p.transport_rate, diesel=p.diesel_multiplier)
    return {
        "supply_plan": plan, "routes": routes,
        "applications": [{"industry_type": a["industry_type"], "use": TYPE_LABEL.get(a["industry_type"]), "raw_material": a["raw_material"],
                          "match_score": a["match_score"]} for a in apps],
        "spec": spec, "spec_labels": {k: plabel(k) for k in spec}, "virgin_price": price, "price_source": price_src,
        "virgin_co2": primary["virgin_co2_per_tonne"], "raw_material": primary["raw_material"],
        "alternatives": alternatives,
    }
