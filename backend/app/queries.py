"""Shared read helpers: DB rows -> API dicts, cached optimisation/impact results."""
from sqlalchemy.orm import Session, joinedload

from .engines import graph_engine, optimizer, scoring
from .models import Demand, Industry, Match, WasteStream
from .services import industry_dict, load_candidates

_cache: dict = {}


def invalidate():
    _cache.clear()


def industries_map(db: Session) -> dict[int, dict]:
    return {i.id: industry_dict(i) for i in db.query(Industry).all()}


def node(d: dict) -> dict:
    return {k: d[k] for k in ("id", "name", "type", "cluster", "lat", "lon")}


def match_dict(m: Match, inds: dict[int, dict]) -> dict:
    ws, dm = m.waste_stream, m.demand
    src, dst = inds[ws.industry_id], inds[dm.industry_id]
    yearly = max(m.tradable_tonnes * 12, 1e-9)
    return dict(
        id=m.id, waste_stream_id=ws.id, demand_id=dm.id, src_id=src["id"], dst_id=dst["id"],
        source=node(src), buyer=node(dst), waste_name=ws.waste_name, waste_source=ws.source, trust=ws.verification_status,
        category=ws.category, hazardous=ws.hazardous, material=dm.material, supply=ws.monthly_tonnes,
        demand=dm.monthly_tonnes, score=m.score, technical_fit=m.technical_fit, economic_score=m.economic_score,
        co2_score=m.co2_score, distance_score=m.distance_score, timing_score=m.timing_score,
        distance_km=m.distance_km, tradable_tonnes=m.tradable_tonnes, saving_per_tonne=m.saving_per_tonne,
        net_saving_per_year=m.net_saving_per_year, co2_saved_per_year=m.co2_saved_per_year,
        co2_per_tonne=m.co2_saved_per_year / yearly, processing_steps=m.processing_steps,
        regulatory_flags=m.regulatory_flags,
    )


def all_matches(db: Session) -> list[dict]:
    if "matches" not in _cache:
        inds = industries_map(db)
        rows = (db.query(Match).options(joinedload(Match.waste_stream), joinedload(Match.demand))
                .order_by(Match.score.desc()).all())
        _cache["matches"] = [match_dict(m, inds) for m in rows]
    return _cache["matches"]


def in_cluster(m: dict, cluster: str | None) -> bool:
    return cluster is None or m["source"]["cluster"] == cluster


def kpis(matches: list[dict], inds: dict[int, dict], cluster: str | None, carbon_price: float = 0) -> dict:
    """Totals use the LP allocation so one waste stream is never counted twice."""
    ms = [m for m in matches if in_cluster(m, cluster)]
    opt = optimizer.optimize(ms, carbon_price)
    clusters = [cluster] if cluster else sorted({d["cluster"] for d in inds.values()})
    loops = sum(len(graph_engine.find_loops(graph_engine.build_graph(matches, inds, c))) for c in clusters)
    return {
        "saving_per_year": opt["total_saving_per_year"], "co2_per_year": opt["total_co2_per_year"],
        "waste_diverted_per_year": opt["total_tonnes_per_year"], "matches": len(ms), "loops": loops,
        "industries": sum(1 for d in inds.values() if cluster is None or d["cluster"] == cluster),
        "allocations": opt["allocations"],
    }


def cached_kpis(db: Session, cluster: str | None) -> dict:
    key = ("kpis", cluster)
    if key not in _cache:
        _cache[key] = kpis(all_matches(db), industries_map(db), cluster)
    return _cache[key]


def simulate(db: Session, cluster: str | None, params: scoring.Params) -> list[dict]:
    """Rescore every candidate in memory (no DB writes). Returns match-like dicts."""
    inds = industries_map(db)
    ids = {(m["waste_stream_id"], m["demand_id"]): m["id"] for m in all_matches(db)}
    out = []
    for s in scoring.score_all(load_candidates(db), params):
        src, dst = inds[s["src_id"]], inds[s["dst_id"]]
        if cluster and src["cluster"] != cluster:
            continue
        out.append({**s, "id": ids.get((s["waste_stream_id"], s["demand_id"])), "source": node(src), "buyer": node(dst)})
    return out


def stream_out(s: WasteStream) -> dict:
    return dict(id=s.id, waste_name=s.waste_name, category=s.category, monthly_tonnes=s.monthly_tonnes,
                composition=s.composition, hazardous=s.hazardous, seasonality=s.seasonality, source=s.source,
                confidence=s.confidence, reasoning=s.reasoning, trust=s.verification_status,
                property_sources=s.property_sources or {}, assumptions=s.assumptions or [])


def demand_out(d: Demand) -> dict:
    return dict(id=d.id, material=d.material, monthly_tonnes=d.monthly_tonnes, spec=d.spec,
                virgin_price=d.virgin_price, virgin_co2=d.virgin_co2, seasonality=d.seasonality,
                accepted_substitutes=d.accepted_substitutes)
