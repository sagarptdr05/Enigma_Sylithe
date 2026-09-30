"""Missing Link Discovery: source -> processor -> buyer routes, yield- and capacity-aware.
A route is a hypothesis until properties, capacity, cost and timing are validated."""
import json

from sqlalchemy.orm import Session

from . import scoring
from .assessment import property_rows
from .costing import CostInputs, landed_cost
from .distance import road_km
from .matching import canonical
from ..config import DATA_DIR
from ..models import Industry, Processor, WasteStream


def seed_processors(db: Session) -> None:
    """Load the synthetic example facilities once; registered facilities are added through the API."""
    from ..auth import now_iso
    if db.query(Processor).count():
        return
    for p in json.loads((DATA_DIR / "processors.json").read_text())["processors"]:
        db.add(Processor(code=p["id"], name=p["name"], cluster=p["cluster"], lat=p["lat"], lon=p["lon"], accepts=p["accepts"],
                         output_label=p["output_label"], sets=p["sets"], yield_share=p["yield"], cost_per_tonne=p["cost_per_tonne"],
                         capacity_tpm=p["capacity_tpm"], steps=p["steps"], unresolved=p["unresolved"], source="synthetic",
                         status="unconfirmed", updated_at=now_iso()))
    db.commit()


def processor_out(p: Processor) -> dict:
    return {"id": p.id, "code": p.code, "name": p.name, "cluster": p.cluster, "lat": p.lat, "lon": p.lon, "accepts": p.accepts,
            "output_label": p.output_label, "sets": p.sets, "yield": p.yield_share, "cost_per_tonne": p.cost_per_tonne,
            "capacity_tpm": p.capacity_tpm, "steps": p.steps, "energy_kwh_per_tonne": p.energy_kwh_per_tonne,
            "hazardous_permitted": p.hazardous_permitted, "source": p.source, "status": p.status, "updated_at": p.updated_at,
            "operator_industry_id": p.operator_industry_id, "unresolved": p.unresolved}


def processors(db: Session) -> list[dict]:
    return [processor_out(p) for p in db.query(Processor).all()]


def find_routes(db: Session, *, material: str, spec: dict, accepted: list[str], lat: float, lon: float, need: float,
                baseline_price: float, virgin_co2: float, exclude_industry: int | None = None, max_leg_km: float = 300,
                transport_rate: float = 4.5, diesel: float = 1.0, processing_multiplier: float = 1.0, limit: int = 6) -> list[dict]:
    accepted_set = set(accepted)
    streams = [s for s in db.query(WasteStream).all() if s.industry_id != exclude_industry and canonical(s.waste_name) in accepted_set]
    inds = {i.id: i for i in db.query(Industry).all()}
    out = []
    for p in processors(db):
        for s in streams:
            name = canonical(s.waste_name)
            if name not in p["accepts"]:
                continue
            src = inds[s.industry_id]
            leg1, leg2 = road_km(src.lat, src.lon, p["lat"], p["lon"]), road_km(p["lat"], p["lon"], lat, lon)
            if leg1 > max_leg_km or leg2 > max_leg_km:
                continue
            before = property_rows(s.composition or {}, {k: "ai_inferred" for k in (s.composition or {})}, spec)
            after_comp = {**(s.composition or {}), **p["sets"]}
            after = property_rows(after_comp, {**{k: "ai_inferred" for k in (s.composition or {})}, **{k: "processor_typical" for k in p["sets"]}}, spec)
            if any(r["status"] == "FAIL" for r in after):
                continue  # processor cannot fix a critical property: reject the route
            improves = any(b["status"] in ("FAIL", "UNKNOWN") and a["status"] == "PASS" for b, a in zip(before, after))
            if not improves:
                continue
            into = min(s.monthly_tonnes, p["capacity_tpm"])
            usable = into * p["yield"]
            # cost per delivered tonne of processed output, both transport legs, processing losses carried by the output
            per_out_material = (leg1 * transport_rate * diesel + p["cost_per_tonne"] * processing_multiplier) / p["yield"]
            ci = CostInputs(material_price=round(per_out_material, 2), material_price_basis="ESTIMATE", distance_km=leg2,
                            transport_rate=transport_rate, diesel_multiplier=diesel, monthly_tonnes=min(usable, need) or None,
                            baseline_price=baseline_price)
            lc = landed_cost(ci)
            unknown = [r["label"] for r in after if r["status"] == "UNKNOWN"]
            out.append({
                "source": {"id": src.id, "name": src.name, "type": src.type, "cluster": src.cluster, "lat": src.lat, "lon": src.lon},
                "waste_stream_id": s.id, "material": s.waste_name, "trust": s.verification_status,
                "processor": {k: p[k] for k in ("id", "name", "cluster", "lat", "lon", "output_label", "yield", "cost_per_tonne", "capacity_tpm", "steps", "source", "status")},
                "legs_km": [round(leg1, 1), round(leg2, 1)], "input_tonnes": round(into, 1), "usable_tonnes": round(usable, 1),
                "coverage_pct": round(min(usable / need, 1) * 100, 1) if need else None,
                "capacity_limited": s.monthly_tonnes > p["capacity_tpm"],
                "properties_before": before, "properties_after": after,
                "landed_cost_per_usable_tonne": lc["cost_per_usable_tonne"], "saving_per_usable_tonne": lc["saving_per_usable_tonne"],
                "verdict": lc["verdict"], "co2_per_usable_tonne_estimate": round(virgin_co2 - (leg1 + leg2) * scoring.TRANSPORT_CO2_PER_KM, 3),
                "status": "hypothesis" if (unknown or p["status"] != "confirmed") else "validated_inputs", "unknown_after": len(unknown),
                "assumptions": ["Supplier releases the material at no charge (disposal cost avoided)",
                                f"Processor yield {p['yield']:.0%}, gate fee ₹{p['cost_per_tonne']:,.0f}/t and capacity {p['capacity_tpm']:,.0f} t/month are "
                                + ("confirmed by the operator" if p["status"] == "confirmed" else "typical, not quoted")],
                "unresolved": (["Properties still unknown after processing: " + ", ".join(unknown)] if unknown else []) + list(p["unresolved"] or [])
                              + (["Hazardous input: processor authorisation required"] if s.hazardous and not p["hazardous_permitted"] else [])
                              + (["Example facility (synthetic data), not a registered operator"] if p["source"] == "synthetic" else [])
                              + (["Operator has not confirmed capacity and gate fee"] if p["status"] != "confirmed" else []),
            })
    # fully resolving routes first, then cheaper; at most 2 routes per processor so options stay diverse
    out.sort(key=lambda r: (r["verdict"] != "cheaper", r["unknown_after"], r["landed_cost_per_usable_tonne"] or 1e12))
    per_proc, uniq = {}, []
    for r in out:
        pid = r["processor"]["id"]
        if per_proc.get(pid, 0) < 2:
            per_proc[pid] = per_proc.get(pid, 0) + 1
            uniq.append(r)
    return uniq[:limit]
