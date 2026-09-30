"""Pipeline glue: persist inferred waste streams / demands for industries."""
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.orm import Session

from .engines import inference, llm
from .models import Demand, Industry, WasteStream


def industry_dict(ind: Industry) -> dict:
    return dict(id=ind.id, name=ind.name, type=ind.type, cluster=ind.cluster, address=ind.address, lat=ind.lat, lon=ind.lon,
                capacity=ind.capacity, capacity_unit=ind.capacity_unit, process_description=ind.process_description)


def populate_industry(db: Session, ind: Industry, declared: list[str], streams: list[dict] | None = None) -> None:
    d = industry_dict(ind)
    streams = streams if streams is not None else inference.infer_all(d, declared)
    for s in streams:
        db.add(WasteStream(industry_id=ind.id, **s))
    for dm in inference.build_demands(d):
        db.add(Demand(industry_id=ind.id, **dm))


def populate_all(db: Session, raw_industries: list[dict]) -> int:
    declared = {r["id"]: r.get("declared_wastes", []) for r in raw_industries}
    inds = db.query(Industry).all()
    dicts = [industry_dict(i) for i in inds]
    # LLM calls are I/O bound - run them concurrently when a key is configured
    workers = 8 if llm.available() else 1
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda d: inference.infer_all(d, declared.get(d["id"], [])), dicts))
    for ind, streams in zip(inds, results):
        populate_industry(db, ind, declared.get(ind.id, []), streams)
    db.commit()
    return len(inds)


# ---------------------------------------------------------------- matching
from .engines import matching, scoring  # noqa: E402
from .models import Match  # noqa: E402

MATCH_FIELDS = ["score", "technical_fit", "economic_score", "co2_score", "distance_score", "timing_score",
                "distance_km", "tradable_tonnes", "saving_per_tonne", "net_saving_per_year", "co2_saved_per_year",
                "processing_steps", "regulatory_flags"]
_candidates: list[dict] | None = None


def stream_dict(s: WasteStream) -> dict:
    return dict(id=s.id, industry_id=s.industry_id, waste_name=s.waste_name, category=s.category,
                monthly_tonnes=s.monthly_tonnes, composition=s.composition, hazardous=s.hazardous,
                seasonality=s.seasonality, source=s.source, confidence=s.confidence, reasoning=s.reasoning,
                disposal_cost_per_tonne=s.disposal_cost_per_tonne)


def demand_dict(d: Demand) -> dict:
    return dict(id=d.id, industry_id=d.industry_id, material=d.material, monthly_tonnes=d.monthly_tonnes,
                spec=d.spec, virgin_price=d.virgin_price, virgin_co2=d.virgin_co2, seasonality=d.seasonality,
                accepted_substitutes=d.accepted_substitutes)


def load_candidates(db: Session, refresh: bool = False) -> list[dict]:
    """All parameter-independent candidate pairs, cached in memory for the simulator/optimizer."""
    global _candidates
    if _candidates is None or refresh:
        inds = {i.id: industry_dict(i) for i in db.query(Industry).all()}
        streams = [stream_dict(s) for s in db.query(WasteStream).all()]
        demands = [demand_dict(d) for d in db.query(Demand).all()]
        _candidates = matching.find_candidates(streams, demands, inds)
    return _candidates


def compute_all_matches(db: Session) -> int:
    """Upsert matches keyed by (waste stream, demand) so ids stay stable for existing exchanges."""
    from .models import Inquiry

    cands = load_candidates(db, refresh=True)
    scored = {(m["waste_stream_id"], m["demand_id"]): m for m in scoring.score_all(cands, scoring.Params())}
    referenced = {mid for (mid,) in db.query(Inquiry.match_id).all()}
    for row in db.query(Match).all():
        m = scored.pop((row.waste_stream_id, row.demand_id), None)
        if m:
            for k in MATCH_FIELDS:
                setattr(row, k, m[k])
        elif row.id not in referenced:
            db.delete(row)
    db.add_all(Match(waste_stream_id=m["waste_stream_id"], demand_id=m["demand_id"],
                     **{k: m[k] for k in MATCH_FIELDS}) for m in scored.values())
    db.commit()
    return db.query(Match).count()


def sync_kb_specs(db: Session) -> bool:
    """Push knowledge-base spec changes (e.g. a new purity requirement) into existing demands. Returns True if changed."""
    from .engines import kb as kbmod
    from .models import DemandKB

    changed = False
    by_key = {(r["industry_type"], r["raw_material"]): r for r in kbmod.demand_kb()}
    for row in db.query(DemandKB).all():
        r = by_key.get((row.industry_type, row.raw_material))
        if r and row.required_spec != r["required_spec"]:
            row.required_spec = r["required_spec"]
            changed = True
    if changed:
        for dm in db.query(Demand).join(Industry).all():
            r = by_key.get((dm.industry.type, dm.material))
            if r:
                dm.spec = r["required_spec"]
        db.commit()
    return changed


def compute_matches_for_industry(db: Session, industry_id: int) -> int:
    """Incremental: add matches involving one (new) industry, keeping existing match ids stable."""
    cands = load_candidates(db, refresh=True)
    co2_max = scoring.co2_normaliser(cands)
    mine = [c for c in cands if industry_id in (c["src_id"], c["dst_id"])]
    scored = scoring.score_all(mine, scoring.Params(), co2_max)
    db.add_all(Match(waste_stream_id=m["waste_stream_id"], demand_id=m["demand_id"],
                     **{k: m[k] for k in MATCH_FIELDS}) for m in scored)
    db.commit()
    return len(scored)
