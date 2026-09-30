from collections import Counter, defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..database import get_db
from ..engines import graph_engine, scoring
from ..engines.assessment import assess
from ..engines.discovery import evidence_by_stream
from ..engines.exchange import ACTIVE_STAGES
from ..models import Demand, Inquiry, WasteStream
from ..services import load_candidates

router = APIRouter(tags=["graph"])


def edge_status(db: Session) -> dict[int, str]:
    """Match id -> exchange status. Inferred edges are never shown as transactions."""
    rank = {"ASSESSED": 1, "AGREED": 2, "ACTIVE": 3, "COMPLETED": 4}
    out: dict[int, str] = {}
    for q in db.query(Inquiry).filter(Inquiry.status.in_(["accepted", "completed", "pending"])).all():
        st = ("COMPLETED" if q.status == "completed" else "ACTIVE" if q.stage in ACTIVE_STAGES else "AGREED" if q.stage == "agreement"
              else "ASSESSED" if q.stage != "interest" else None)
        if st and rank[st] > rank.get(out.get(q.match_id, ""), 0):
            out[q.match_id] = st
    return out


def _graph(db: Session, cluster: str | None):
    inds = {i: privacy.mask_node(d) for i, d in queries.industries_map(db).items()}
    g = graph_engine.build_graph(queries.all_matches(db), inds, cluster)
    trust = {m["id"]: m.get("trust") for m in queries.all_matches(db)}
    status = edge_status(db)
    for a, b, d in g.edges(data=True):
        d["status"] = status.get(d["match_id"]) or ("POTENTIAL" if trust.get(d["match_id"]) in ("user_declared", "verified") else "INFERRED")
    return g


@router.get("/graph")
def graph(cluster: str | None = None, db: Session = Depends(get_db)):
    return graph_engine.to_json(_graph(db, cluster))


@router.get("/graph/loops")
def loops(cluster: str | None = None, db: Session = Depends(get_db)):
    g = _graph(db, cluster)
    lp, ch = graph_engine.find_loops(g), graph_engine.find_chains(g)
    return {"loops": lp, "chains": ch,
            "totals": {"loops": len(lp), "chains": len(ch),
                       "loop_saving": sum(l["total_saving"] for l in lp), "loop_co2": sum(l["total_co2"] for l in lp)}}


@router.get("/network/gaps")
def gaps(cluster: str, db: Session = Depends(get_db)):
    """Opportunity funnel + where it breaks: supply, demand, evidence, processing and geography gaps."""
    p = scoring.Params()
    all_c = load_candidates(db)
    co2_max = scoring.co2_normaliser(all_c)
    cands = [c for c in all_c if c["src_cluster"] == cluster]
    tech_ok = [c for c in cands if c["technical_fit"] >= 0.6]
    scored = [(c, scoring.score_one(c, p, co2_max)) for c in tech_ok]
    econ_ok = [c for c, sc in scored if sc]
    ws = {s.id: s for s in db.query(WasteStream).filter(WasteStream.id.in_({c["waste_stream_id"] for c in cands})).all()}
    dm = {d.id: d for d in db.query(Demand).filter(Demand.id.in_({c["demand_id"] for c in cands})).all()}
    ev = evidence_by_stream(db, list(ws))
    missing_ev, ev_ready, tx_ready = Counter(), [], []
    for c in econ_ok:
        s, d = ws[c["waste_stream_id"]], dm[c["demand_id"]]
        a = assess(ws=s, evidence=ev[s.id], spec=d.spec or {}, material=d.material, need_tonnes=d.monthly_tonnes, virgin_price=d.virgin_price,
                   virgin_co2=d.virgin_co2, distance_km=c["distance_km"], processing_steps=c["processing_steps"], regulatory_flags=c["regulatory_flags"])
        for i in a["evidence"]["items"]:
            if i["status"] == "missing":
                missing_ev[i["key"]] += 1
        if a["evidence"]["completeness"] >= 0.999:
            ev_ready.append(c)
            if all(r["status"] in ("PASS", "FIXABLE") for r in a["properties"]):
                tx_ready.append(c)
    funnel = [("Potential material exchanges", len(cands)), ("Technically feasible", len(tech_ok)), ("Economically feasible", len(econ_ok)),
              ("Evidence-ready", len(ev_ready)), ("Transaction-ready", len(tx_ready))]
    drops = [(funnel[i][0], funnel[i - 1][1] - funnel[i][1], funnel[i][1] / funnel[i - 1][1] if funnel[i - 1][1] else 1) for i in range(1, len(funnel))]
    worst = min(drops, key=lambda d: d[2])
    bottleneck = {"Technically feasible": "Material properties (spec mismatch)", "Economically feasible": "Economics: transport and processing costs",
                  "Evidence-ready": "Evidence: lab reports, quantity confirmation and permits are missing",
                  "Transaction-ready": "Unknown properties still need testing"}[worst[0]]

    inds = queries.industries_map(db)
    in_cluster = {i for i, d in inds.items() if d["cluster"] == cluster}
    viable = queries.all_matches(db)
    has_supplier = {m["demand_id"] for m in viable}
    has_buyer = {m["waste_stream_id"] for m in viable}
    supply_gap, demand_gap = defaultdict(lambda: {"plants": 0, "monthly": 0.0}), defaultdict(lambda: {"plants": 0, "monthly": 0.0, "inferred": 0})
    for d in db.query(Demand).filter(Demand.industry_id.in_(in_cluster)).all():
        if d.id not in has_supplier:
            supply_gap[d.material]["plants"] += 1
            supply_gap[d.material]["monthly"] += d.monthly_tonnes
    for s in db.query(WasteStream).filter(WasteStream.industry_id.in_(in_cluster)).all():
        if s.id not in has_buyer:
            demand_gap[s.waste_name]["plants"] += 1
            demand_gap[s.waste_name]["monthly"] += s.monthly_tonnes
            demand_gap[s.waste_name]["inferred"] += s.source != "declared"
    proc, geo = Counter(), Counter()
    for c, sc in scored:
        virgin = c["virgin_price"]
        transport = c["distance_km"] * p.transport_rate
        if not sc and virgin - transport + c["disposal"] > 0 and c["processing_steps"]:
            proc[c["processing_steps"][0]["step"]] += 1
        elif sc and virgin and c["processing_cost"] / virgin > 0.3:
            proc[c["processing_steps"][0]["step"]] += 1
        if (c["distance_km"] > p.max_distance) or (not sc and virgin - c["processing_cost"] + c["disposal"] > 0):
            geo[c["waste_name"]] += 1
    labels = {"quantity": "Supplier quantity confirmation", "composition": "Composition lab report", "contamination": "Contamination analysis / SDS",
              "authorisation": "Hazardous-waste authorisation", "metering": "Heat metering log"}
    return {
        "cluster": cluster, "funnel": [{"stage": a, "count": b} for a, b in funnel],
        "bottleneck": {"stage": worst[0], "lost": worst[1], "explanation": bottleneck},
        "supply_gaps": sorted([{"material": k, **v} for k, v in supply_gap.items()], key=lambda x: -x["monthly"])[:8],
        "demand_gaps": sorted([{"material": k, **v} for k, v in demand_gap.items()], key=lambda x: -x["monthly"])[:8],
        "evidence_gaps": [{"item": labels.get(k, k), "matches": v} for k, v in missing_ev.most_common()],
        "processing_gaps": [{"step": k, "matches": v} for k, v in proc.most_common(6)],
        "geography_gaps": [{"material": k, "matches": v} for k, v in geo.most_common(6)],
    }
