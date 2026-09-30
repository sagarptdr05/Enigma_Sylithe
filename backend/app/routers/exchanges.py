"""Exchange workspace: an Inquiry evolves from interest to a completed, impact-recorded exchange."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..auth import current_user, now_iso
from ..database import get_db
from ..engines import exchange as X
from ..engines.assessment import assess
from ..engines.matching import canonical, regulatory_flags
from ..engines.assessment import property_rows
from ..engines.impact import BOUNDARY, net_benefit, step_energy_key
from ..factors import registry
from ..engines.qualification import generate_checklist
from ..notify import notify
from ..models import Batch, ChecklistItem, Evidence, ExchangeEvent, Inquiry, Match, User

DEFAULT_RESPONSIBILITIES = {"transport": "buyer", "loading_unloading": "supplier", "processing_before_dispatch": "supplier",
                            "sampling_and_testing": "buyer", "nonconforming_batch_replacement": "supplier",
                            "return_or_disposal_of_rejected_loads": "supplier", "hazardous_manifest_and_permits": "supplier",
                            "late_delivery_notice": "supplier"}
RESP_VALUES = {"supplier", "buyer", "shared"}

router = APIRouter(prefix="/exchanges", tags=["exchanges"])


class ExchangeCreate(BaseModel):
    match_id: int
    monthly_tonnes: float | None = Field(None, gt=0)
    price_per_tonne: float | None = Field(None, ge=0)
    message: str | None = Field(None, max_length=2000)
    reveal_identity: bool = True
    include_stages: list[str] | None = None  # optional stages: evidence, assessment, sample, trial


class ActionBody(BaseModel):
    action: str
    text: str | None = Field(None, max_length=2000)
    result: str | None = None  # pass | fail
    price: float | None = Field(None, ge=0)
    tonnes: float | None = Field(None, gt=0)
    reference: str | None = Field(None, max_length=120)
    reveal_identity: bool = True
    values: dict[str, float] | None = None  # batch test results
    accepted_tonnes: float | None = Field(None, ge=0)
    rejected_tonnes: float | None = Field(None, ge=0)
    corrective_action: str | None = Field(None, max_length=1000)
    promised_date: str | None = Field(None, max_length=20)
    item_id: int | None = None
    status: str | None = None  # checklist: done | failed | waived | open
    responsibilities: dict[str, str] | None = None
    acceptance_criteria: dict[str, tuple[float, float]] | None = None


def parties(q: Inquiry) -> tuple[int, int]:
    return q.match.waste_stream.industry_id, q.match.demand.industry_id


def log(db: Session, q: Inquiry, kind: str, actor: int | None, text: str | None = None, data: dict | None = None, stage: str | None = None):
    db.add(ExchangeEvent(inquiry_id=q.id, stage=stage or q.stage, kind=kind, actor_industry_id=actor, text=text, data=data or {}, created_at=now_iso()))


def _label(q: Inquiry) -> str:
    return f"{q.match.waste_stream.waste_name} → {q.match.demand.material}"


def alert_exchange(db: Session, q: Inquiry, user: User, text: str, also_facilitators: bool = False) -> None:
    """Tell the other side (and facilitators when asked) what just happened. No company names in the text."""
    sup, buy = parties(q)
    others = [i for i in (sup, buy) if i != user.industry_id]
    notify(db, kind="exchange", title=f"Exchange #{q.id} · {_label(q)}", body=text, link=f"/exchange/{q.id}",
           industry_ids=others, facilitators=also_facilitators, exclude_user=user.id)


def create_exchange(db: Session, user: User, body: ExchangeCreate) -> Inquiry:
    m = db.get(Match, body.match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    sup, buy = m.waste_stream.industry_id, m.demand.industry_id
    me = user.industry_id
    if me not in (sup, buy):
        raise HTTPException(403, "You can only open exchanges on your own matches")
    if db.query(Inquiry).filter(Inquiry.match_id == m.id, Inquiry.from_industry_id == me,
                                Inquiry.status.in_(["pending", "accepted"])).first():
        raise HTTPException(409, "You already have an open exchange on this match")
    bad = set(body.include_stages or []) - X.OPTIONAL
    if bad:
        raise HTTPException(400, f"Unknown optional stages: {', '.join(bad)}")
    role = "supplier" if me == sup else "buyer"
    q = Inquiry(match_id=m.id, from_industry_id=me, to_industry_id=buy if me == sup else sup, kind="offer" if role == "supplier" else "request",
                monthly_tonnes=body.monthly_tonnes or m.tradable_tonnes, price_per_tonne=body.price_per_tonne, message=body.message,
                status="pending", created_at=now_iso(), updated_at=now_iso(), stage="interest",
                stages=X.build_stages(body.include_stages), supplier_consent=body.reveal_identity and role == "supplier",
                buyer_consent=body.reveal_identity and role == "buyer", signatures={}, stage_data={})
    if body.price_per_tonne is not None:
        q.stage_data = {"offer": {"by": role, "price": body.price_per_tonne, "tonnes": q.monthly_tonnes, "at": now_iso()}}
    db.add(q)
    db.flush()
    log(db, q, "transition", me, "Opportunity discovered by Sylithex", {"to": "discovery"}, stage="discovery")
    log(db, q, "transition", me, f"{'Offer' if role == 'supplier' else 'Interest'} sent" + (f": {body.message}" if body.message else ""),
        {"to": "interest", "reveal_identity": body.reveal_identity})
    q.responsibilities = dict(DEFAULT_RESPONSIBILITIES)
    q.acceptance_criteria = dict(m.demand.spec or {})
    ensure_checklist(db, q)
    alert_exchange(db, q, user, f"New {'offer' if role == 'supplier' else 'request'} from a {'supplier' if role == 'supplier' else 'buyer'}"
                   + (f" at ₹{body.price_per_tonne:,.0f}/t" if body.price_per_tonne else "") + f", {q.monthly_tonnes:,.0f} t/month. Reply to move it forward.")
    db.commit()
    return q


def ensure_checklist(db: Session, q: Inquiry) -> None:
    """Trial planner: generated once from the real spec gaps, missing evidence and processing needs."""
    if db.query(ChecklistItem).filter_by(inquiry_id=q.id).count():
        return
    a = _match_assessment(db, q)
    ws = q.match.waste_stream
    for it in generate_checklist(assessment=a, processing_steps=q.match.processing_steps, category=ws.category, hazardous=ws.hazardous,
                                 monthly_tonnes=q.monthly_tonnes, include_sample="sample" in q.stages, include_trial=True):
        db.add(ChecklistItem(inquiry_id=q.id, **it))


def record_delivery(db: Session, q: Inquiry, bt: Batch) -> None:
    """Every receipt updates the material's monthly supply history with real platform data."""
    from ..models import SupplyRecord
    month = bt.received_at[:7]
    rec = db.query(SupplyRecord).filter_by(waste_stream_id=q.match.waste_stream_id, month=month).first()
    on_time = (bt.received_at[:10] <= bt.promised_date) if bt.promised_date else None
    if rec is None or rec.source == "demo":
        if rec is not None:
            db.delete(rec)
            db.flush()
        rec = SupplyRecord(waste_stream_id=q.match.waste_stream_id, month=month, available_tonnes=q.match.waste_stream.monthly_tonnes,
                           committed_tonnes=0, delivered_tonnes=0, source="platform", recorded_at=now_iso())
        db.add(rec)
    rec.source = "platform"
    rec.committed_tonnes = (rec.committed_tonnes or 0) + bt.dispatched_tonnes
    rec.delivered_tonnes = (rec.delivered_tonnes or 0) + (bt.received_tonnes or 0)
    rec.on_time = on_time if rec.on_time is None else (rec.on_time and bool(on_time) if on_time is not None else rec.on_time)


def accepted_total(db: Session, q: Inquiry) -> float | None:
    bs = db.query(Batch).filter_by(inquiry_id=q.id).all()
    if bs:
        vals = [b.accepted_tonnes for b in bs if b.accepted_tonnes is not None]
        return round(sum(vals), 1) if vals else None
    return q.received_tonnes if q.status == "completed" else None  # exchanges recorded before batch tracking


def impact_record(db: Session, q: Inquiry) -> dict:
    m = q.match
    f = registry(db)
    acc = accepted_total(db, q)
    est_t = (q.agreed_tonnes or q.monthly_tonnes) * 12
    reported = net_benefit(acc, m.demand.virgin_co2, m.distance_km, m.processing_steps, f) if q.status == "completed" else {"status": "insufficient_data", "label": "Not delivered yet"}
    used = ["diesel_combustion", "truck_fuel_intensity", "grid_electricity"] + sorted({k for k in (step_energy_key(s["step"]) for s in m.processing_steps) if k})
    return {
        "estimate": {**net_benefit(est_t, m.demand.virgin_co2, m.distance_km, m.processing_steps, f), "basis": "Pre-exchange estimate: agreed or requested monthly quantity x 12"},
        "reported": {**reported, "basis": "Post-exchange: accepted tonnes recorded by the buyer"},
        "verified": {"status": "verified" if q.impact_verified_at else "not_verified", "by": q.impact_verified_by, "at": q.impact_verified_at,
                     "basis": "Independently checked by a facilitator against delivery records" if q.impact_verified_at else "Not independently verified"},
        "used_tonnes": q.used_tonnes, "accepted_tonnes": acc, "saving_estimate": round((acc or 0) * m.saving_per_tonne) if acc else None,
        "boundary": BOUNDARY,
        "factors": {**{k: {"label": f[k]["label"], "value": f[k]["value"], "unit": f[k]["unit"], "source": f[k]["source"], "date": f[k]["reference_year"], "status": f[k]["status"]} for k in used},
                    "virgin_material": {"label": f"Virgin {m.demand.material}", "value": m.demand.virgin_co2, "unit": "tCO2 per tonne", "source": "Sylithex knowledge base (typical production emissions)", "date": "2026", "status": "default"}},
        "note": "Estimates are not certified carbon credits or lifecycle results.",
    }


def _match_assessment(db: Session, q: Inquiry) -> dict:
    m = q.match
    ws, dm = m.waste_stream, m.demand
    ev = db.query(Evidence).filter_by(waste_stream_id=ws.id).all()
    return assess(ws=ws, evidence=ev, spec=dm.spec or {}, material=dm.material, need_tonnes=dm.monthly_tonnes,
                  virgin_price=dm.virgin_price, virgin_co2=dm.virgin_co2, distance_km=m.distance_km,
                  processing_steps=m.processing_steps, regulatory_flags=m.regulatory_flags or regulatory_flags(canonical(ws.waste_name), ws.hazardous),
                  timing_score=m.timing_score, agreed_price=q.agreed_price)


def exchange_out(db: Session, q: Inquiry, me: int | None, inds: dict | None = None, detail: bool = False) -> dict:
    inds = inds or queries.industries_map(db)
    sup, buy = parties(q)
    role = X.role_of(me, sup, buy) if me else None
    other = q.to_industry_id if q.from_industry_id == me else q.from_industry_id
    revealed = q.supplier_consent and q.buyer_consent
    hide_other = privacy.is_confidential(other) and not revealed and not privacy.is_facilitator()

    def shown(n: dict) -> dict:
        return privacy.hide_node(n) if hide_other and n.get("id") == other else n

    cp = shown(queries.node(inds[other]))
    m = queries.match_dict(q.match, inds)
    owner, action = X.STAGE_INFO[q.stage]
    waiting_on = None
    if q.status in ("pending", "accepted") and owner:
        if owner == "recipient":
            waiting_on = "you" if q.to_industry_id == me else "counterparty"
        elif owner in ("either",):
            waiting_on = "either party"
        elif owner == "both":
            missing = [r for r in ("supplier", "buyer") if r not in (q.signatures or {})]
            waiting_on = "you" if role in missing else ("counterparty" if missing else None)
        else:
            waiting_on = "you" if owner == role else "counterparty"
    out = {
        "id": q.id, "kind": q.kind, "status": q.status, "stage": q.stage, "stages": q.stages,
        "direction": "outgoing" if q.from_industry_id == me else "incoming", "role": role,
        "monthly_tonnes": q.monthly_tonnes, "price_per_tonne": q.price_per_tonne, "message": q.message, "reply": q.reply,
        "created_at": q.created_at, "updated_at": q.updated_at, "counterparty": cp,
        "consent": {"supplier": q.supplier_consent, "buyer": q.buyer_consent, "identity_revealed": revealed},
        "counterparty_contact": _contact(db, other) if revealed and q.status != "declined" else None,
        "next": {"owner": owner, "action": action, "waiting_on": waiting_on},
        "terms": {"price": q.agreed_price, "tonnes": q.agreed_tonnes, "offer": (q.stage_data or {}).get("offer"), "signatures": q.signatures or {}},
        "quantities": {"dispatched": q.dispatched_tonnes, "received": q.received_tonnes},
        "repeat_of": q.repeat_of, "completed_at": q.completed_at,
        "match": ({k: m[k] for k in ("id", "waste_name", "material", "score", "distance_km", "tradable_tonnes", "net_saving_per_year",
                                                       "co2_saved_per_year", "category", "hazardous", "regulatory_flags", "saving_per_tonne",
                                                       "co2_per_tonne", "waste_stream_id")} | {"source": shown(m["source"]), "buyer": shown(m["buyer"])}),
    }
    acc = accepted_total(db, q) if q.status == "completed" else None
    if acc:
        out["impact"] = {"tonnes": acc, "saving": round(acc * m["saving_per_tonne"]), "co2": round(acc * m["co2_per_tonne"], 1),
                         "verified": bool(q.impact_verified_at),
                         "basis": ("Independently verified" if q.impact_verified_at else "Buyer-reported") + " accepted quantity x estimated per-tonne value"}
    if detail:
        a = _match_assessment(db, q)
        out["assessment"] = {k: a[k] for k in ("gates", "readiness", "evidence", "properties", "economics", "why_match", "concerns")}
        out["stage_data"] = q.stage_data or {}
        out["events"] = [{"id": e.id, "stage": e.stage, "kind": e.kind, "text": e.text, "data": e.data, "created_at": e.created_at,
                          "actor": "you" if e.actor_industry_id == me else ("platform" if e.actor_industry_id is None else "counterparty")}
                         for e in q.events]
        out["evidence_count"] = db.query(Evidence).filter(Evidence.waste_stream_id == q.match.waste_stream_id, Evidence.status != "rejected").count()
        out["checklist"] = [{k: getattr(c, k) for k in ("id", "position", "kind", "title", "owner", "due_date", "acceptance_criteria", "status", "notes", "completed_by", "completed_at")}
                            for c in db.query(ChecklistItem).filter_by(inquiry_id=q.id).order_by(ChecklistItem.position).all()]
        spec = q.acceptance_criteria or q.match.demand.spec or {}
        out["batches"] = [{**{k: getattr(b, k) for k in ("id", "batch_code", "dispatched_tonnes", "dispatched_at", "manifest_ref", "promised_date", "received_tonnes",
                                                         "received_at", "test_values", "test_date", "accepted_tonnes", "rejected_tonnes", "status", "rejection_reason", "corrective_action")},
                           "checks": property_rows(b.test_values or {}, {k: "batch_test" for k in (b.test_values or {})}, spec) if b.test_values else []}
                          for b in db.query(Batch).filter_by(inquiry_id=q.id).order_by(Batch.id).all()]
        out["responsibilities"] = q.responsibilities or {}
        out["acceptance_criteria"] = spec
        out["impact_record"] = impact_record(db, q)
        out["facilitation_requested"] = bool(q.facilitation_requested)
        from ..buyer import landed_for_match
        lc = landed_for_match(q.match, agreed_price=q.agreed_price)
        out["landed_cost"] = {k: lc[k] for k in ("cost_per_usable_tonne", "baseline_per_usable_tonne", "saving_per_usable_tonne", "verdict", "usable_share")}
    return out


def _contact(db: Session, industry_id: int) -> dict | None:
    u = db.query(User).filter_by(industry_id=industry_id).first()
    return {"name": u.contact_name, "designation": u.designation, "email": u.email, "phone": u.phone} if u else None


def _get(db: Session, xid: int, user: User) -> Inquiry:
    q = db.get(Inquiry, xid)
    if not q or (user.industry_id not in (q.from_industry_id, q.to_industry_id) and user.role != "facilitator"):
        raise HTTPException(404, "Exchange not found")  # 404, not 403: don't confirm it exists (IDOR)
    return q


def apply_action(db: Session, q: Inquiry, user: User, b: ActionBody) -> None:
    sup, buy = parties(q)
    me = user.industry_id
    if b.action == "verify_impact":
        if user.role != "facilitator":
            raise HTTPException(403, "Only a facilitator can independently verify impact")
        if q.status != "completed" or not accepted_total(db, q):
            raise HTTPException(409, "Impact can be verified only after delivery is accepted")
        q.impact_verified_by, q.impact_verified_at = user.contact_name, now_iso()
        log(db, q, "consent", None, f"Impact verified against delivery records by {user.contact_name}")
        return
    role = X.role_of(me, sup, buy)
    if role is None:
        raise HTTPException(403, "Only the two companies in this exchange can act on it")
    if b.action == "record_use":
        acc = accepted_total(db, q)
        if q.status != "completed" or not acc:
            raise HTTPException(409, "Record use after the delivery is accepted")
        if role != "buyer":
            raise HTTPException(403, "Only the buyer records how much was used")
        if not b.tonnes or b.tonnes > acc:
            raise HTTPException(400, f"Used quantity must be between 0 and the accepted {acc:,.0f}")
        q.used_tonnes = b.tonnes
        log(db, q, "comment", me, f"Used in production: {b.tonnes:,.0f}")
        return
    if b.action == "comment":
        if not b.text:
            raise HTTPException(400, "Comment text is required")
        log(db, q, "comment", me, b.text)
        return
    if q.status in ("declined", "closed", "completed"):
        raise HTTPException(409, f"This exchange is {q.status}")
    if b.action == "consent":
        setattr(q, f"{role}_consent", True)
        log(db, q, "consent", me, f"{role.title()} agreed to reveal identity")
        return
    if b.action == "request_facilitation":
        q.facilitation_requested = True
        log(db, q, "comment", me, "Facilitator support requested" + (f": {b.text}" if b.text else ""))
        return
    if b.action == "update_checklist":
        item = db.get(ChecklistItem, b.item_id or -1)
        if not item or item.inquiry_id != q.id:
            raise HTTPException(404, "Checklist item not found")
        if b.status not in ("done", "failed", "waived", "open"):
            raise HTTPException(400, "status must be done, failed, waived or open")
        if item.kind == "decision" and role != "buyer":
            raise HTTPException(403, "Only the buyer's authorised reviewer can approve industrial use")
        if item.owner not in (role, "both") and item.kind != "decision":
            raise HTTPException(403, f"This task is owned by the {item.owner}")
        item.status, item.notes = b.status, b.text or item.notes
        item.completed_by, item.completed_at = (role, now_iso()) if b.status != "open" else (None, None)
        log(db, q, "comment", me, f"Checklist: {item.title} → {b.status}" + (f" ({b.text})" if b.text else ""))
        return
    if b.action == "set_terms":
        if q.stage in ("dispatch", "receipt", "acceptance", "completed"):
            raise HTTPException(409, "Terms are fixed once delivery has started")
        if b.responsibilities:
            bad = {k: v for k, v in b.responsibilities.items() if v not in RESP_VALUES}
            if bad:
                raise HTTPException(400, "Responsibility must be supplier, buyer or shared")
            q.responsibilities = {**(q.responsibilities or {}), **b.responsibilities}
        if b.acceptance_criteria:
            q.acceptance_criteria = {k: list(v) for k, v in b.acceptance_criteria.items()}
        if q.signatures:
            q.signatures = {}
            log(db, q, "blocker", me, "Terms changed after signing: signatures reset")
        log(db, q, "comment", me, "Responsibilities / acceptance criteria updated")
        return
    if b.action == "withdraw":
        if q.stage in X.COMMITTED_STAGES:
            raise HTTPException(409, "After agreement, use reject_delivery or a comment instead of withdrawing")
        q.status = "closed"
        log(db, q, "transition", me, f"Withdrawn by {role}" + (f": {b.text}" if b.text else ""), {"to": "closed"})
        return
    if b.action not in X.ACTIONS[q.stage]:
        raise HTTPException(409, f"'{b.action}' is not possible at the {q.stage} stage")
    if not X.may_act(q.stage, role, q.to_industry_id == me):
        raise HTTPException(403, f"Waiting for the {X.STAGE_INFO[q.stage][0]} to act at the {q.stage} stage")

    def advance(note: str):
        prev = q.stage
        q.stage = X.next_stage(q.stages, q.stage)
        log(db, q, "transition", me, note, {"from": prev, "to": q.stage}, stage=prev)
        if q.stage == "completed":
            q.status, q.completed_at = "completed", now_iso()

    st = q.stage
    if st == "interest":
        if b.action == "decline":
            q.status, q.reply = "declined", b.text
            log(db, q, "transition", me, "Declined" + (f": {b.text}" if b.text else ""), {"to": "declined"})
            return
        q.status, q.reply = "accepted", b.text
        if b.reveal_identity:
            setattr(q, f"{role}_consent", True)
        advance("Interest accepted" + (f": {b.text}" if b.text else "") + ("" if b.reveal_identity else " (identity kept confidential)"))
    elif st == "evidence":
        n = db.query(Evidence).filter(Evidence.waste_stream_id == q.match.waste_stream_id, Evidence.status != "rejected").count()
        if n == 0:
            raise HTTPException(409, "Upload at least one evidence document on the material passport first")
        advance(f"Evidence package submitted ({n} document{'s' if n > 1 else ''})")
    elif st in ("assessment", "sample", "trial"):
        if b.result not in ("pass", "fail"):
            raise HTTPException(400, "result must be pass or fail")
        q.stage_data = {**(q.stage_data or {}), st: {"result": b.result, "notes": b.text, "at": now_iso()}}
        if b.result == "fail":
            q.status = "closed"
            log(db, q, "transition", me, f"{st.title()} failed" + (f": {b.text}" if b.text else ""), {"to": "closed"})
        else:
            advance(f"{st.title()} passed" + (f": {b.text}" if b.text else ""))
    elif st == "negotiation":
        if b.action == "offer":
            if b.price is None or not b.tonnes:
                raise HTTPException(400, "An offer needs a price and a monthly quantity")
            q.stage_data = {**(q.stage_data or {}), "offer": {"by": role, "price": b.price, "tonnes": b.tonnes, "at": now_iso()}}
            log(db, q, "offer", me, f"Offer: ₹{b.price:,.0f}/unit for {b.tonnes:,.0f}/month" + (f" - {b.text}" if b.text else ""),
                {"price": b.price, "tonnes": b.tonnes})
        else:
            offer = (q.stage_data or {}).get("offer")
            if not offer:
                raise HTTPException(409, "There is no offer to accept yet")
            if offer["by"] == role:
                raise HTTPException(409, "You cannot accept your own offer")
            q.agreed_price, q.agreed_tonnes = offer["price"], offer["tonnes"]
            advance(f"Offer accepted: ₹{offer['price']:,.0f}/unit, {offer['tonnes']:,.0f}/month")
    elif st == "agreement":
        if role in (q.signatures or {}):
            raise HTTPException(409, "You have already signed")
        q.signatures = {**(q.signatures or {}), role: now_iso()}
        log(db, q, "consent", me, f"Agreement signed by {role}")
        if len(q.signatures) == 2:
            advance("Agreement signed by both parties")
    elif st == "dispatch":
        if not b.tonnes:
            raise HTTPException(400, "Dispatched quantity is required")
        if q.match.waste_stream.hazardous and not b.reference:
            raise HTTPException(400, "Hazardous material needs a manifest (Form 10) reference")
        q.dispatched_tonnes = b.tonnes
        n = db.query(Batch).filter_by(inquiry_id=q.id).count() + 1
        code = f"X{q.id}-B{n:02d}"
        db.add(Batch(inquiry_id=q.id, batch_code=code, dispatched_tonnes=b.tonnes, dispatched_at=now_iso(), manifest_ref=b.reference,
                     promised_date=b.promised_date, status="in_transit"))
        advance(f"Batch {code}: dispatched {b.tonnes:,.0f}" + (f" (manifest {b.reference})" if b.reference else ""))
    elif st == "receipt":
        if not b.tonnes:
            raise HTTPException(400, "Received quantity is required")
        if q.dispatched_tonnes and b.tonnes > q.dispatched_tonnes * 1.05:
            raise HTTPException(400, "Received quantity exceeds the dispatched quantity")
        q.received_tonnes = b.tonnes
        bt = db.query(Batch).filter_by(inquiry_id=q.id).order_by(Batch.id.desc()).first()
        if bt:
            bt.received_tonnes, bt.received_at, bt.status = b.tonnes, now_iso(), "received"
            record_delivery(db, q, bt)
        advance(f"Received {b.tonnes:,.0f} at the gate" + (f" (batch {bt.batch_code})" if bt else ""))
    elif st == "acceptance":
        bt = db.query(Batch).filter_by(inquiry_id=q.id).order_by(Batch.id.desc()).first()
        spec = q.acceptance_criteria or q.match.demand.spec or {}
        if bt and b.values:
            bt.test_values, bt.test_date = {k: float(v) for k, v in b.values.items()}, now_iso()[:10]
        checks = property_rows(bt.test_values or {}, {}, spec) if bt and bt.test_values else []
        fails = [r["label"] for r in checks if r["status"] == "FAIL"]
        if b.action == "reject_delivery":
            if bt:
                bt.status, bt.rejected_tonnes, bt.accepted_tonnes = "rejected", bt.received_tonnes, 0
                bt.rejection_reason = b.text or ("Out of spec: " + ", ".join(fails) if fails else "Rejected at inspection")
                bt.corrective_action = b.corrective_action
            q.stage, q.dispatched_tonnes, q.received_tonnes = "dispatch", None, None
            log(db, q, "blocker", me, "Deviation: batch rejected" + (f" - {bt.rejection_reason}" if bt else "") +
                (f". Corrective action: {b.corrective_action}" if b.corrective_action else ""), {"to": "dispatch"})
        else:
            recv = (bt.received_tonnes if bt else q.received_tonnes) or 0
            acc = b.accepted_tonnes if b.accepted_tonnes is not None else recv - (b.rejected_tonnes or 0)
            rej = b.rejected_tonnes if b.rejected_tonnes is not None else max(recv - acc, 0)
            if acc <= 0 or acc + rej > recv * 1.001:
                raise HTTPException(400, "Accepted + rejected must add up to the received quantity")
            if bt:
                bt.accepted_tonnes, bt.rejected_tonnes = acc, rej
                bt.status = "partial" if rej > 0 else "accepted"
                if rej > 0:
                    bt.rejection_reason, bt.corrective_action = b.text, b.corrective_action
            if fails:
                log(db, q, "blocker", me, f"Accepted by the buyer despite FAIL on {', '.join(fails)} (buyer's decision)")
            if rej > 0:
                log(db, q, "blocker", me, f"Deviation: {rej:,.0f} rejected from batch" + (f" - {b.text}" if b.text else ""))
            advance(f"Delivery accepted: {acc:,.0f} accepted" + (f", {rej:,.0f} rejected" if rej else "") + ". Exchange completed and impact recorded")


@router.post("")
def create(body: ExchangeCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = create_exchange(db, user, body)
    return exchange_out(db, q, user.industry_id, detail=True)


@router.get("")
def list_mine(user: User = Depends(current_user), db: Session = Depends(get_db)):
    me = user.industry_id
    inds = queries.industries_map(db)
    rows = db.query(Inquiry).filter((Inquiry.from_industry_id == me) | (Inquiry.to_industry_id == me)).order_by(Inquiry.id.desc()).all()
    out = [exchange_out(db, q, me, inds) for q in rows]
    return {"incoming": [o for o in out if o["direction"] == "incoming"], "outgoing": [o for o in out if o["direction"] == "outgoing"],
            "pending_incoming": sum(1 for o in out if o["next"]["waiting_on"] == "you")}


@router.get("/{xid}")
def get_one(xid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = _get(db, xid, user)
    if not db.query(ChecklistItem).filter_by(inquiry_id=q.id).count():
        ensure_checklist(db, q)
        q.responsibilities = q.responsibilities or dict(DEFAULT_RESPONSIBILITIES)
        db.commit()
    return exchange_out(db, q, user.industry_id, detail=True)


@router.post("/{xid}/action")
def action(xid: int, body: ActionBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = _get(db, xid, user)
    last = db.query(ExchangeEvent.id).filter_by(inquiry_id=q.id).order_by(ExchangeEvent.id.desc()).limit(1).scalar() or 0
    apply_action(db, q, user, body)
    q.updated_at = now_iso()
    db.flush()
    new = [e.text for e in db.query(ExchangeEvent).filter(ExchangeEvent.inquiry_id == q.id, ExchangeEvent.id > last).order_by(ExchangeEvent.id) if e.text]
    if new or body.action == "request_facilitation":
        alert_exchange(db, q, user, "; ".join(new)[:900] or "Facilitator help requested",
                       also_facilitators=body.action == "request_facilitation")
    db.commit()
    queries.invalidate()
    return exchange_out(db, q, user.industry_id, detail=True)


@router.post("/{xid}/repeat")
def repeat(xid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Transaction memory: start a new exchange pre-filled from a completed one (assessment already proven)."""
    old = _get(db, xid, user)
    if old.status != "completed":
        raise HTTPException(409, "Only completed exchanges can be repeated")
    sup, buy = parties(old)
    role = X.role_of(user.industry_id, sup, buy)
    q = Inquiry(match_id=old.match_id, from_industry_id=user.industry_id, to_industry_id=buy if role == "supplier" else sup,
                kind="offer" if role == "supplier" else "request", monthly_tonnes=old.agreed_tonnes or old.monthly_tonnes,
                price_per_tonne=old.agreed_price, message=f"Repeat of exchange #{old.id} on the same terms", status="pending",
                created_at=now_iso(), updated_at=now_iso(), stage="interest", stages=X.build_stages([]),
                supplier_consent=True, buyer_consent=True, signatures={}, repeat_of=old.id,
                stage_data={"offer": {"by": role, "price": old.agreed_price, "tonnes": old.agreed_tonnes, "at": now_iso()}})
    q.responsibilities, q.acceptance_criteria = dict(old.responsibilities or DEFAULT_RESPONSIBILITIES), dict(old.acceptance_criteria or {})
    db.add(q)
    db.flush()
    log(db, q, "transition", user.industry_id, f"Repeat of exchange #{old.id}: specification, responsibilities and evidence carried over", {"to": "interest"})
    alert_exchange(db, q, user, f"Repeat of exchange #{old.id} proposed on the same terms.")
    db.commit()
    return exchange_out(db, q, user.industry_id, detail=True)
