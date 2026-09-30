from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..database import get_db
from ..engines import optimizer, scoring
from ..schemas import ClusterParams

router = APIRouter(tags=["simulate"])


def to_params(body: ClusterParams) -> scoring.Params:
    return scoring.Params(**body.params.model_dump())


@router.post("/optimize")
def optimize(body: ClusterParams, db: Session = Depends(get_db)):
    p = to_params(body)
    return optimizer.optimize(queries.simulate(db, body.cluster, p), p.carbon_price)


@router.post("/simulate")
def simulate(body: ClusterParams, db: Session = Depends(get_db)):
    p = to_params(body)
    inds = queries.industries_map(db)
    new = queries.simulate(db, body.cluster, p)
    base = [m for m in queries.all_matches(db) if queries.in_cluster(m, body.cluster)]
    new_keys = {(m["waste_stream_id"], m["demand_id"]) for m in new}
    dropped = []
    for m in base:
        if (m["waste_stream_id"], m["demand_id"]) in new_keys:
            continue
        reason = (f"Distance {m['distance_km']:.0f} km exceeds {p.max_distance:.0f} km"
                  if m["distance_km"] > p.max_distance else "Transport + processing now exceed virgin price")
        dropped.append({**m, "reason": reason})
    k = queries.kpis(new, inds, body.cluster, p.carbon_price)
    baseline = queries.cached_kpis(db, body.cluster)
    return {
        "params": body.params.model_dump(),
        "kpis": {key: v for key, v in k.items() if key != "allocations"},
        "baseline": {key: v for key, v in baseline.items() if key != "allocations"},
        "viable_count": len(new), "baseline_count": len(base),
        "dropped": privacy.mask_matches(dropped[:50]), "dropped_count": len(dropped),
        "matches": [privacy.mask_match({key: m[key] for key in ("id", "source", "buyer", "waste_name", "material", "score",
                                             "tradable_tonnes", "net_saving_per_year", "distance_km")}) for m in new[:150]],
    }
