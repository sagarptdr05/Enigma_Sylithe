from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..engines.exchange import COMMITTED_STAGES
from ..models import Inquiry
from ..database import get_db

router = APIRouter(tags=["clusters"])
CONTEXT = {"Taloja MIDC": "heavy", "Tarapur MIDC": "heavy", "Kolhapur Agro Belt": "agro", "Pune-Chakan Urban": "urban"}


@router.get("/clusters")
def clusters(db: Session = Depends(get_db)):
    inds = queries.industries_map(db)
    out = []
    for c in sorted({d["cluster"] for d in inds.values()}):
        members = [d for d in inds.values() if d["cluster"] == c]
        k = queries.cached_kpis(db, c)
        out.append({
            "name": c, "context": CONTEXT.get(c, "mixed"),
            "center": {"lat": sum(d["lat"] for d in members) / len(members),
                       "lon": sum(d["lon"] for d in members) / len(members)},
            **{key: v for key, v in k.items() if key != "allocations"},
        })
    return out


@router.get("/impact")
def impact(cluster: str | None = None, db: Session = Depends(get_db)):
    k = queries.cached_kpis(db, cluster)
    matches = [m for m in queries.all_matches(db) if queries.in_cluster(m, cluster)]
    by_cat: dict[str, float] = defaultdict(float)
    mlookup = {(m["waste_stream_id"], m["demand_id"]): m for m in matches}
    for a in k["allocations"]:
        m = mlookup.get((a["waste_stream_id"], a["demand_id"]))
        by_cat[m["category"] if m else "other"] += a["monthly_tonnes"] * 12
    by_cluster = []
    if cluster is None:
        for c in sorted({m["source"]["cluster"] for m in matches}):
            ck = queries.cached_kpis(db, c)
            by_cluster.append({"cluster": c, "saving_per_year": ck["saving_per_year"],
                               "co2_per_year": ck["co2_per_year"], "waste_diverted_per_year": ck["waste_diverted_per_year"]})
    return {
        **{key: v for key, v in k.items() if key != "allocations"},
        "tiers": impact_tiers(db, cluster, k),
        "by_category": [{"category": c, "tonnes_per_year": round(t)} for c, t in sorted(by_cat.items(), key=lambda x: -x[1])],
        "by_cluster": by_cluster,
        "top": privacy.mask_matches(sorted(matches, key=lambda m: m["net_saving_per_year"], reverse=True)[:10]),
    }


def impact_tiers(db: Session, cluster: str | None, k: dict) -> dict:
    """Never mix these: potential (model), committed (signed agreements), reported (accepted tonnes recorded by
    buyers) and independently verified (checked by a facilitator). Net CO2 subtracts transport and processing."""
    from ..engines.impact import net_benefit
    from ..factors import registry
    from .exchanges import accepted_total
    f = registry(db)
    mdict = {m["id"]: m for m in queries.all_matches(db)}
    blank = lambda: {"saving": 0.0, "co2": 0.0, "tonnes": 0.0, "exchanges": 0}
    committed, reported, verified = blank(), blank(), blank()
    for q in db.query(Inquiry).filter(Inquiry.status.in_(["accepted", "completed"])).all():
        m = mdict.get(q.match_id)
        if not m or not queries.in_cluster(m, cluster):
            continue
        if q.status == "completed":
            acc = accepted_total(db, q)
            if acc:
                nb = net_benefit(acc, q.match.demand.virgin_co2, q.match.distance_km, q.match.processing_steps, f)
                for bucket in ([reported, verified] if q.impact_verified_at else [reported]):
                    bucket["tonnes"] += acc
                    bucket["saving"] += acc * m["saving_per_tonne"]
                    bucket["co2"] += nb["net_tco2"]
                    bucket["exchanges"] += 1
        elif q.stage in COMMITTED_STAGES and q.agreed_tonnes:
            t = q.agreed_tonnes * 12
            committed["tonnes"] += t
            committed["saving"] += t * m["saving_per_tonne"]
            committed["co2"] += t * m["co2_per_tonne"]
            committed["exchanges"] += 1
    r = lambda d: {key: round(v, 1) if isinstance(v, float) else v for key, v in d.items()}
    return {
        "potential": {"saving": k["saving_per_year"], "co2": k["co2_per_year"], "tonnes": k["waste_diverted_per_year"], "exchanges": k["matches"],
                      "basis": "Model estimate: every viable match, LP-allocated, per year"},
        "committed": {**r(committed), "basis": "Signed agreements not yet delivered: agreed monthly quantity x 12"},
        "reported": {**r(reported), "basis": "Accepted tonnes recorded by buyers after delivery (to date); net CO2 after transport and processing"},
        "verified": {**r(verified), "basis": "Subset of reported results independently checked by a facilitator"},
    }


@router.get("/showcase")
def showcase(db: Session = Depends(get_db)):
    """IDs of the demo scenario so explanatory pages can link to live records (no hard-coded ids)."""
    from ..buyer import landed_for_match
    from ..engines.assessment import assess
    from ..engines.qualification import eligibility
    from ..models import Demand, Evidence, Industry, Match, WasteStream
    sup = db.query(Industry).filter_by(name="Deccan Phosphates & Fertilizers Ltd").first()
    buy = db.query(Industry).filter_by(name="Raigad Cement Works Ltd").first()
    out: dict = {"match_id": None, "material_id": None, "completed_exchange_id": None, "preview": None}
    if sup and buy:
        m = (db.query(Match).join(WasteStream, Match.waste_stream_id == WasteStream.id).join(Demand, Match.demand_id == Demand.id)
             .filter(WasteStream.industry_id == sup.id, Demand.industry_id == buy.id, WasteStream.waste_name == "Phosphogypsum").first())
        if m:
            ws, dm = m.waste_stream, m.demand
            a = assess(ws=ws, evidence=db.query(Evidence).filter_by(waste_stream_id=ws.id).all(), spec=dm.spec or {}, material=dm.material,
                       need_tonnes=dm.monthly_tonnes, virgin_price=dm.virgin_price, virgin_co2=dm.virgin_co2, distance_km=m.distance_km,
                       processing_steps=m.processing_steps, regulatory_flags=m.regulatory_flags)
            lc = landed_for_match(m)
            out.update(match_id=m.id, material_id=ws.id, preview={
                "material": ws.waste_name, "replaces": dm.material, "buyer": "Cement plant, Taloja", "supplier": "Confidential supplier, Taloja",
                "properties": a["properties"], "eligibility": eligibility(a), "evidence": a["evidence"]["completeness"],
                "landed": lc["cost_per_usable_tonne"], "baseline": lc["baseline_per_usable_tonne"], "main_blocker": a["readiness"]["main_blocker"]})
    done = next((q for q in db.query(Inquiry).filter_by(status="completed").all() if (q.stage_data or {}).get("seed") == "bf-slag-completed"), None)
    out["completed_exchange_id"] = done.id if done else None
    return out
