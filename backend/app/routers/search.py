from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..database import get_db
from ..engines import kb
from ..engines.distance import road_km
from ..engines.similarity import similarity
from ..models import WasteStream

router = APIRouter(tags=["search"])


@router.get("/search/reverse")
def reverse_search(material: str, lat: float, lon: float, qty: float = Query(100, gt=0),
                   max_distance: float = 300, db: Session = Depends(get_db)):
    """Who nearby has a waste that can replace `material`? Matches raw-material names and waste names."""
    accepted: dict[str, float] = {}
    for d in kb.demand_kb():
        s = similarity(material, d["raw_material"])
        if s >= 0.6:
            for w in d["accepted_substitutes"]:
                accepted[w] = max(accepted.get(w, 0), s)
    for w in kb.waste_vocabulary():
        accepted[w] = max(accepted.get(w, 0), similarity(material, w))
    accepted = {w: s for w, s in accepted.items() if s >= 0.6}
    inds = queries.industries_map(db)
    results = []
    for ws in db.query(WasteStream).filter(WasteStream.waste_name.in_(list(accepted))).all():
        ind = inds[ws.industry_id]
        dist = road_km(lat, lon, ind["lat"], ind["lon"])
        if dist > max_distance:
            continue
        sim = accepted[ws.waste_name]
        coverage = min(1.0, ws.monthly_tonnes / qty)
        score = 100 * (0.4 * sim + 0.35 * (1 - dist / max_distance) + 0.25 * coverage)
        results.append({
            "waste_stream_id": ws.id, "industry": privacy.mask_node(queries.node(ind)), "trust": ws.verification_status, "waste_name": ws.waste_name,
            "category": ws.category, "monthly_tonnes": ws.monthly_tonnes, "source": ws.source,
            "hazardous": ws.hazardous, "distance_km": round(dist, 1), "similarity": round(sim, 3),
            "coverage": round(coverage, 3), "transport_cost_per_tonne": round(dist * 4.5, 0), "score": round(score, 1),
        })
    results.sort(key=lambda r: r["score"], reverse=True)
    return {"material": material, "matched_wastes": sorted(accepted, key=lambda w: -accepted[w]), "results": results[:30]}
