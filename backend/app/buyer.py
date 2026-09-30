"""Buyer-side execution services: landed cost for a match, supply panel, backup finder and supplier
track record. Glue between DB rows and the pure engines (costing, supply, qualification, routes)."""
from sqlalchemy.orm import Session

from . import privacy, queries
from .engines import scoring
from .engines.assessment import assess
from .engines.costing import CostInputs, break_even_distance, landed_cost, processing_yield, sensitivity
from .engines.qualification import eligibility
from .engines.supply import allocate, coverage, freshness, reliability
from .models import Batch, Evidence, Inquiry, Match, SupplyRecord, WasteStream

TRANSFER_SHARE = 0.35  # indicative price paid to the supplier until the parties agree one


def cost_inputs(m: Match, overrides: dict | None = None, params: scoring.Params | None = None, agreed_price: float | None = None) -> CostInputs:
    p = params or scoring.Params()
    dm, ws = m.demand, m.waste_stream
    o = {k: v for k, v in (overrides or {}).items() if v is not None}
    virgin = dm.virgin_price * p.virgin_price_multiplier
    price = o.pop("material_price", None)
    basis = "USER PROVIDED" if price is not None or agreed_price is not None else "ESTIMATE"
    price = price if price is not None else (agreed_price if agreed_price is not None else round(virgin * TRANSFER_SHARE))
    base = dict(material_price=price, material_price_basis=basis, distance_km=m.distance_km, transport_rate=p.transport_rate,
                diesel_multiplier=p.diesel_multiplier, processing=sum(s["cost_per_tonne"] for s in m.processing_steps) * p.processing_multiplier,
                monthly_tonnes=min(ws.monthly_tonnes * p.supply_multiplier, dm.monthly_tonnes * p.demand_multiplier),
                processing_yield=processing_yield(m.processing_steps), baseline_price=virgin)
    base.update(o)
    return CostInputs(**base)


def landed_for_match(m: Match, overrides: dict | None = None, params: scoring.Params | None = None, agreed_price: float | None = None) -> dict:
    ci = cost_inputs(m, overrides, params, agreed_price)
    out = landed_cost(ci)
    out["sensitivity"] = sensitivity(ci)
    out["break_even_km"] = break_even_distance(ci)
    return out


def platform_deliveries(db: Session, stream_id: int) -> list[dict]:
    """Batches actually received on the platform for this material (the real reliability evidence)."""
    rows = (db.query(Batch).join(Inquiry, Batch.inquiry_id == Inquiry.id).join(Match, Inquiry.match_id == Match.id)
            .filter(Match.waste_stream_id == stream_id, Batch.received_tonnes.isnot(None)).all())
    return [{"dispatched": b.dispatched_tonnes, "received": b.received_tonnes, "accepted": b.accepted_tonnes,
             "on_time": (b.received_at[:10] <= b.promised_date) if (b.promised_date and b.received_at) else None} for b in rows]


def supply_panel(db: Session, ws: WasteStream, need: float | None) -> dict:
    recs = db.query(SupplyRecord).filter_by(waste_stream_id=ws.id).order_by(SupplyRecord.month).all()
    deliveries = platform_deliveries(db, ws.id)
    unit = "MWh" if ws.category == "energy" else "t"
    return {"available": ws.monthly_tonnes, "unit": unit, "min_order": ws.min_order_tonnes, "delivery_window": ws.delivery_window,
            "trust": ws.verification_status, "freshness": freshness(ws.availability_updated_at), "reliability": reliability(recs, deliveries),
            **({"need": need, **coverage(need, ws.monthly_tonnes)} if need else {}),
            "history": [{"month": r.month, "available": r.available_tonnes, "committed": r.committed_tonnes, "delivered": r.delivered_tonnes,
                         "on_time": r.on_time, "source": r.source} for r in recs]}


def backups_for_match(db: Session, m: Match, params: scoring.Params | None = None) -> dict:
    """Every other source for the same buyer demand, compared on quality, coverage, landed cost, distance,
    timing and CO2; then a capacity-safe allocation that covers the demand."""
    from .services import load_candidates
    p = params or scoring.Params()
    dm = m.demand
    need = dm.monthly_tonnes * p.demand_multiplier
    co2_max = scoring.co2_normaliser(load_candidates(db))
    cands = [c for c in load_candidates(db) if c["demand_id"] == dm.id]
    ids = {c["waste_stream_id"] for c in cands}
    streams = {s.id: s for s in db.query(WasteStream).filter(WasteStream.id.in_(ids)).all()}
    ev = {}
    for e in db.query(Evidence).filter(Evidence.waste_stream_id.in_(ids)).all():
        ev.setdefault(e.waste_stream_id, []).append(e)
    rows = db.query(Match).filter(Match.demand_id == dm.id).all()
    match_by_ws = {r.waste_stream_id: r for r in rows}
    inds = queries.industries_map(db)
    options = []
    for c in cands:
        s = streams[c["waste_stream_id"]]
        a = assess(ws=s, evidence=ev.get(s.id, []), spec=dm.spec or {}, material=dm.material, need_tonnes=dm.monthly_tonnes,
                   virgin_price=dm.virgin_price, virgin_co2=dm.virgin_co2, distance_km=c["distance_km"], processing_steps=c["processing_steps"],
                   regulatory_flags=c["regulatory_flags"], timing_score=c["timing"], params=p)
        el = eligibility(a)
        mrow = match_by_ws.get(s.id)
        lc = landed_cost(cost_inputs(mrow, params=p)) if mrow else None
        scored = scoring.score_one(c, p, co2_max)
        recs = db.query(SupplyRecord).filter_by(waste_stream_id=s.id).all()
        options.append({
            "id": s.id, "match_id": mrow.id if mrow else None, "is_primary": s.id == m.waste_stream_id,
            "supplier": privacy.mask_node(queries.node(inds[s.industry_id])), "material": s.waste_name, "trust": s.verification_status,
            "capacity": round(s.monthly_tonnes * p.supply_multiplier, 1), "distance_km": round(c["distance_km"], 1),
            "technical_fit": round(a["technical_fit"], 3), "eligibility": el["status"], "evidence_completeness": a["evidence"]["completeness"],
            "timing": round(c["timing"], 3), "co2_per_tonne": round(c["virgin_co2"] - c["distance_km"] * scoring.TRANSPORT_CO2_PER_KM, 3),
            "cost": lc["cost_per_usable_tonne"] if lc else None, "score": scored["score"] if scored else None,
            "qualified": s.verification_status in ("user_declared", "verified") and a["evidence"]["completeness"] >= 0.6,
            "eligible": el["status"] != "not_eligible" and scored is not None,
            "freshness": freshness(s.availability_updated_at)["status"], "reliability": reliability(recs, platform_deliveries(db, s.id))["level"],
        })
    primary = next((o for o in options if o["is_primary"]), None)
    alloc = allocate(need, options)
    options.sort(key=lambda o: (not o["is_primary"], not o["eligible"], o["cost"] if o["cost"] is not None else 1e12))
    return {"demand": {"id": dm.id, "material": dm.material, "monthly_tonnes": round(need, 1), "baseline_price": dm.virgin_price * p.virgin_price_multiplier},
            "primary": {**coverage(need, primary["capacity"])} if primary else None, "options": options[:12], "allocation": alloc,
            "note": "Allocation never exceeds a supplier's stated capacity. Unqualified sources need qualification before use."}


def track_record(db: Session, industry_id: int) -> dict:
    """Supplier history built only from exchanges and batches on the platform."""
    xs = [q for q in db.query(Inquiry).all() if q.match.waste_stream.industry_id == industry_id]
    batches = db.query(Batch).filter(Batch.inquiry_id.in_([q.id for q in xs])).all() if xs else []
    received = [b for b in batches if b.received_tonnes is not None]
    accepted = sum(b.accepted_tonnes or 0 for b in batches)
    rejected = sum(b.rejected_tonnes or 0 for b in batches)
    docs = db.query(Evidence).join(WasteStream, Evidence.waste_stream_id == WasteStream.id).filter(WasteStream.industry_id == industry_id).all()
    return {"exchanges": len(xs), "completed": sum(1 for q in xs if q.status == "completed"), "batches": len(batches),
            "delivered_tonnes": round(sum(b.received_tonnes for b in received), 1), "accepted_tonnes": round(accepted, 1),
            "rejection_rate_pct": round(rejected / (accepted + rejected) * 100, 1) if (accepted + rejected) else None,
            "evidence_documents": len(docs), "evidence_accepted": sum(1 for d in docs if d.status == "verified"),
            "label": "No delivery history on Sylithex yet" if not batches else f"{len(batches)} batch{'es' if len(batches) > 1 else ''} delivered on Sylithex"}
