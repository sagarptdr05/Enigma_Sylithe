"""Sourcing requests: when no listed supplier exists, find inferred leads and ask them to confirm."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..auth import current_user, now_iso
from ..database import get_db
from ..engines.discovery import discover
from ..notify import notify
from ..models import Industry, SourcingLead, SourcingRequest, User, WasteStream
from ..services import compute_all_matches, industry_dict
from .alternatives import attach_match_ids

router = APIRouter(tags=["sourcing"])


class SourcingBody(BaseModel):
    material: str = Field(min_length=2, max_length=120)
    intended_use: str = Field(min_length=2, max_length=200)
    monthly_tonnes: float = Field(gt=0, le=10_000_000)
    radius_km: float = Field(150, gt=0, le=1000)
    spec: dict[str, tuple[float, float]] = {}
    frequency: str = Field("monthly", max_length=40)
    target_price: float | None = Field(None, gt=0)
    urgency: str = Field("normal", pattern="^(low|normal|high)$")
    evidence_requirements: list[str] = []


def request_out(r: SourcingRequest) -> dict:
    return {k: getattr(r, k) for k in ("id", "industry_id", "material", "intended_use", "monthly_tonnes", "radius_km", "spec", "frequency",
                                       "target_price", "urgency", "evidence_requirements", "status", "created_at")}


@router.post("/sourcing-requests")
def create(body: SourcingBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.industry_id:
        raise HTTPException(403, "Only company accounts can create sourcing requests")
    r = SourcingRequest(industry_id=user.industry_id, material=body.material, intended_use=body.intended_use, monthly_tonnes=body.monthly_tonnes,
                        radius_km=body.radius_km, spec={k: list(v) for k, v in body.spec.items()}, frequency=body.frequency,
                        target_price=body.target_price, urgency=body.urgency, evidence_requirements=body.evidence_requirements[:10],
                        status="open", created_at=now_iso())
    db.add(r)
    db.commit()
    return request_out(r)


@router.get("/sourcing-requests")
def mine(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(SourcingRequest)
    if user.role != "facilitator":
        q = q.filter(SourcingRequest.industry_id == user.industry_id)
    return [request_out(r) for r in q.order_by(SourcingRequest.id.desc()).all()]


def _owned(db: Session, rid: int, user: User) -> SourcingRequest:
    r = db.get(SourcingRequest, rid)
    if not r or (r.industry_id != user.industry_id and user.role != "facilitator"):
        raise HTTPException(404, "Sourcing request not found")
    return r


@router.get("/sourcing-requests/{rid}")
def candidates(rid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = _owned(db, rid, user)
    buyer = db.get(Industry, r.industry_id)
    res = discover(db, intended_use=r.intended_use, current_material=r.material, monthly_tonnes=r.monthly_tonnes, lat=buyer.lat, lon=buyer.lon,
                   max_distance=r.radius_km, current_price=r.target_price, required_spec=r.spec, exclude_industry=r.industry_id)
    attach_match_ids(db, res, r.industry_id)
    leads = {l.waste_stream_id: l for l in db.query(SourcingLead).filter_by(request_id=r.id).all()}
    confirmed, potential = [], []
    for a in res["alternatives"]:
        for s in a["streams"]:
            if not s["viable"]:
                continue
            lead = leads.get(s["waste_stream_id"])
            item = {**s, "material": a["material"], "industry": privacy.mask_node(s["industry"]),
                    "lead": {"id": lead.id, "status": lead.status, "confirmed_tonnes": lead.confirmed_tonnes} if lead else None}
            if s["trust"] in ("user_declared", "verified") or (lead and lead.status == "confirmed"):
                confirmed.append(item)
            else:
                potential.append({**item, "label": "Potential supplier - not yet confirmed"})
    return {"request": request_out(r), "confirmed": confirmed[:15], "potential": potential[:15],
            "note": "Potential suppliers are inferred from industry type and capacity. They are not listed and have not confirmed availability."}


class InviteBody(BaseModel):
    waste_stream_id: int
    note: str | None = Field(None, max_length=1000)


@router.post("/sourcing-requests/{rid}/invite")
def invite(rid: int, body: InviteBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Outreach to an inferred supplier (by the buyer or a facilitator). Creates an unconfirmed lead."""
    r = _owned(db, rid, user)
    if not db.get(WasteStream, body.waste_stream_id):
        raise HTTPException(404, "Material not found")
    lead = db.query(SourcingLead).filter_by(request_id=r.id, waste_stream_id=body.waste_stream_id).first()
    if lead:
        raise HTTPException(409, f"Already {lead.status}")
    lead = SourcingLead(request_id=r.id, waste_stream_id=body.waste_stream_id, status="invited", note=body.note,
                        created_at=now_iso(), updated_at=now_iso())
    db.add(lead)
    s = db.get(WasteStream, body.waste_stream_id)
    notify(db, kind="sourcing", title=f"Can you supply {s.waste_name}?",
           body=f"A buyer needs {r.monthly_tonnes:,.0f} t/month of {r.material} for {r.intended_use}. Sylithex estimates you generate {s.waste_name}. Confirm the quantity or say it is not available.",
           link="/my?tab=sourcing", industry_ids=[s.industry_id], exclude_user=user.id)
    db.commit()
    return {"id": lead.id, "status": lead.status}


@router.get("/sourcing-leads")
def my_leads(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Supplier side: requests asking whether we can supply something we were inferred to generate."""
    rows = (db.query(SourcingLead).join(WasteStream, SourcingLead.waste_stream_id == WasteStream.id)
            .filter(WasteStream.industry_id == user.industry_id).order_by(SourcingLead.id.desc()).all())
    out = []
    for l in rows:
        r = db.get(SourcingRequest, l.request_id)
        s = db.get(WasteStream, l.waste_stream_id)
        out.append({"id": l.id, "status": l.status, "confirmed_tonnes": l.confirmed_tonnes, "note": l.note, "created_at": l.created_at,
                    "material": s.waste_name, "waste_stream_id": s.id, "estimated_tonnes": s.monthly_tonnes, "trust": s.verification_status,
                    "request": request_out(r), "buyer": privacy.mask_node(industry_dict(db.get(Industry, r.industry_id)))})
    return out


class ConfirmBody(BaseModel):
    available: bool
    monthly_tonnes: float | None = Field(None, gt=0, le=10_000_000)
    note: str | None = Field(None, max_length=1000)


@router.post("/sourcing-leads/{lid}/respond")
def respond(lid: int, body: ConfirmBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Only the generating company can turn an inferred lead into confirmed supply."""
    l = db.get(SourcingLead, lid)
    s = db.get(WasteStream, l.waste_stream_id) if l else None
    if not l or s.industry_id != user.industry_id:
        raise HTTPException(404, "Lead not found")
    if l.status != "invited":
        raise HTTPException(409, f"Already {l.status}")
    l.updated_at, l.note = now_iso(), body.note or l.note
    if not body.available:
        l.status = "declined"
    else:
        if not body.monthly_tonnes:
            raise HTTPException(400, "Confirm the monthly quantity you can supply")
        l.status, l.confirmed_tonnes = "confirmed", body.monthly_tonnes
        s.monthly_tonnes = body.monthly_tonnes
        if s.verification_status != "verified":
            s.verification_status = "user_declared"
        s.assumptions = [a for a in (s.assumptions or []) if not a.startswith("Quantity")] + ["Quantity confirmed by the company in response to a sourcing request"]
    r = db.get(SourcingRequest, l.request_id)
    notify(db, kind="sourcing", title=f"{s.waste_name}: supplier {'confirmed' if body.available else 'declined'}",
           body=(f"A potential supplier confirmed {body.monthly_tonnes:,.0f} t/month for your {r.material} request." if body.available
                 else f"A potential supplier said {s.waste_name} is not available for your {r.material} request."),
           link="/my?tab=sourcing", industry_ids=[r.industry_id], exclude_user=user.id)
    db.commit()
    if body.available:
        compute_all_matches(db)
        queries.invalidate()
    return {"id": l.id, "status": l.status, "confirmed_tonnes": l.confirmed_tonnes}
