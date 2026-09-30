from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..auth import optional_user
from ..models import Evidence, Inquiry, User
from ..engines.assessment import assess
from ..database import get_db
from ..engines import explainer, matching
from ..models import Match

router = APIRouter(tags=["matches"])


@router.get("/matches")
def list_matches(industry_id: int | None = None, cluster: str | None = None, min_score: float = 0,
                 limit: int = 100, db: Session = Depends(get_db)):
    out = [m for m in queries.all_matches(db)
           if m["score"] >= min_score and queries.in_cluster(m, cluster)
           and (industry_id is None or industry_id in (m["src_id"], m["dst_id"]))]
    return privacy.mask_matches(out[:limit])


@router.get("/matches/{match_id}")
def match_detail(match_id: int, db: Session = Depends(get_db)):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    inds = queries.industries_map(db)
    d = queries.match_dict(m, inds)
    ws, dm = m.waste_stream, m.demand
    _, rows = matching.technical_fit(ws.composition or {}, dm.spec or {})
    virgin = dm.virgin_price
    processing = sum(s["cost_per_tonne"] for s in m.processing_steps)
    disposal = ws.disposal_cost_per_tonne or 0
    transport = virgin - processing + disposal - m.saving_per_tonne
    d.update(
        source=privacy.mask_node(inds[ws.industry_id]), buyer=privacy.mask_node(inds[dm.industry_id]), trust=ws.verification_status, supply_tonnes=ws.monthly_tonnes,
        demand_tonnes=dm.monthly_tonnes, properties=rows, composition=ws.composition,
        seasonality={"months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                     "supply": [round(ws.monthly_tonnes * s, 1) for s in ws.seasonality],
                     "demand": [round(dm.monthly_tonnes * s, 1) for s in dm.seasonality]},
        economics={"virgin_price": virgin, "transport_cost": round(transport, 2), "processing_cost": processing,
                   "disposal_avoided": disposal, "saving_per_tonne": m.saving_per_tonne},
        waste_reasoning=ws.reasoning, waste_confidence=ws.confidence,
    )
    masked = d["source"].get("hidden") or d["buyer"].get("hidden")
    if m.explanation and not masked:  # cached LLM text contains real names: never serve it masked
        d["explanation"], d["explanation_source"] = m.explanation, "llm"
    elif masked:
        d["explanation"], d["explanation_source"] = explainer.template(d), "template"
    else:
        text, src = explainer.explain(d)
        if src == "llm":
            m.explanation = text
            db.commit()
        d["explanation"], d["explanation_source"] = text, src
    return d


@router.get("/matches/{match_id}/assessment")
def match_assessment(match_id: int, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    """Evidence-gated readiness: property status (PASS/FAIL/FIXABLE/UNKNOWN), gates, blockers with owner + action,
    why / why-not, two-sided economics. The score never hides missing evidence."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    ws, dm = m.waste_stream, m.demand
    ev = db.query(Evidence).filter_by(waste_stream_id=ws.id).all()
    ex = None
    if user and user.industry_id in (ws.industry_id, dm.industry_id):
        q = (db.query(Inquiry).filter(Inquiry.match_id == m.id, Inquiry.status.in_(["pending", "accepted", "completed"]))
             .order_by(Inquiry.id.desc()).first())
        ex = {"id": q.id, "stage": q.stage, "status": q.status} if q else None
    a = assess(ws=ws, evidence=ev, spec=dm.spec or {}, material=dm.material, need_tonnes=dm.monthly_tonnes, virgin_price=dm.virgin_price,
               virgin_co2=dm.virgin_co2, distance_km=m.distance_km, processing_steps=m.processing_steps,
               regulatory_flags=m.regulatory_flags, timing_score=m.timing_score)
    scores = {"technical": a["technical_fit"], "economic": m.economic_score, "distance": m.distance_score,
              "environmental": m.co2_score, "timing": m.timing_score, "evidence": a["evidence"]["completeness"]}
    role = None
    if user and user.industry_id == ws.industry_id:
        role = "supplier"
    elif user and user.industry_id == dm.industry_id:
        role = "buyer"
    from ..buyer import landed_for_match, supply_panel
    from ..engines.qualification import eligibility, evidence_state, factor_breakdown
    agreed = None
    if ex:
        agreed = db.get(Inquiry, ex["id"]).agreed_price
    tests = [e for e in ev if e.type in ("lab_report", "third_party_assessment", "historical_test")]
    latest = max((e.issue_date or e.uploaded_at[:10] for e in tests), default=None)
    return {**a, "scores": scores, "overall_score": m.score, "trust": ws.verification_status, "exchange": ex, "viewer_role": role,
            "waste_stream_id": ws.id, "demand_id": dm.id, "eligibility": eligibility(a), "factors": factor_breakdown(m),
            "landed_cost": landed_for_match(m, agreed_price=agreed), "supply": supply_panel(db, ws, dm.monthly_tonnes),
            "evidence_documents": [{"id": e.id, "type": e.type, "title": e.title, "issuer": e.issuer, "issue_date": e.issue_date,
                                    "expiry_date": e.expiry_date, **evidence_state(e)} for e in ev],
            "latest_test_date": latest}


class LandedBody(BaseModel):
    material_price: float | None = Field(None, ge=0)
    transport_rate: float | None = Field(None, ge=0)
    loading_unloading: float | None = Field(None, ge=0)
    handling: float | None = Field(None, ge=0)
    storage: float | None = Field(None, ge=0)
    processing: float | None = Field(None, ge=0)
    testing_per_month: float | None = Field(None, ge=0)
    other: float | None = Field(None, ge=0)
    monthly_tonnes: float | None = Field(None, gt=0)
    acceptance_yield: float | None = Field(None, gt=0, le=1)
    processing_yield: float | None = Field(None, gt=0, le=1)
    baseline_price: float | None = Field(None, ge=0)
    distance_km: float | None = Field(None, ge=0)


@router.post("/matches/{match_id}/landed-cost")
def match_landed_cost(match_id: int, body: LandedBody, db: Session = Depends(get_db)):
    """True landed cost per usable tonne with the user's own numbers. Nothing is stored."""
    from ..buyer import landed_for_match
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    return landed_for_match(m, body.model_dump())


@router.get("/matches/{match_id}/backups")
def match_backups(match_id: int, db: Session = Depends(get_db)):
    from ..buyer import backups_for_match
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    return backups_for_match(db, m)


@router.get("/matches/{match_id}/routes")
def match_routes(match_id: int, db: Session = Depends(get_db)):
    """Missing links: processor routes that could make other sources usable for this buyer."""
    from ..engines.routes import find_routes
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    dm = m.demand
    buyer = dm.industry
    routes = find_routes(db, material=dm.material, spec=dm.spec or {}, accepted=dm.accepted_substitutes or [], lat=buyer.lat, lon=buyer.lon,
                         need=dm.monthly_tonnes, baseline_price=dm.virgin_price, virgin_co2=dm.virgin_co2, exclude_industry=buyer.id)
    for r in routes:
        r["source"] = privacy.mask_node(r["source"])
    return {"demand": {"material": dm.material, "monthly_tonnes": dm.monthly_tonnes}, "routes": routes,
            "note": "Routes are hypotheses: a graph connection does not prove feasibility until properties, capacity, cost and timing are validated."}
