"""Material Passport, owner edits, reuse pathways and evidence (upload / download / verify)."""
import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..auth import current_user, now_iso, optional_user
from ..config import UPLOAD_DIR
from ..data.seed import load_json
from ..database import get_db
from ..engines import kb, scoring
from ..engines.assessment import effective_properties, plabel
from ..engines.matching import canonical, processing_steps, regulatory_flags
from ..notify import notify
from ..models import Evidence, Industry, Inquiry, User, WasteStream
from ..buyer import supply_panel, track_record
from ..services import compute_all_matches, industry_dict

router = APIRouter(tags=["materials"])
EVIDENCE_TYPES = {"lab_report", "spec_sheet", "sds", "certificate", "historical_test", "user_declaration", "third_party_assessment"}
ALLOWED = {".pdf": b"%PDF", ".png": b"\x89PNG", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".csv": None, ".txt": None}
MAX_BYTES = 5 * 1024 * 1024
TRUST_LABEL = {"verified": "VERIFIED", "user_declared": "USER DECLARED", "ai_inferred": "AI INFERRED", "requires_evidence": "REQUIRES EVIDENCE"}


def _stream(db: Session, sid: int) -> WasteStream:
    s = db.get(WasteStream, sid)
    if not s:
        raise HTTPException(404, "Material not found")
    return s


def _is_owner(user: User | None, s: WasteStream) -> bool:
    return bool(user and (user.industry_id == s.industry_id))


def _can_read_files(db: Session, user: User | None, s: WasteStream) -> bool:
    """Owner, facilitator, or a counterparty with mutual consent on an exchange for this material."""
    if not user:
        return False
    if user.role == "facilitator" or user.industry_id == s.industry_id:
        return True
    for q in db.query(Inquiry).filter((Inquiry.from_industry_id == user.industry_id) | (Inquiry.to_industry_id == user.industry_id)).all():
        if q.match.waste_stream_id == s.id and q.supplier_consent and q.buyer_consent:
            return True
    return False


def evidence_out(e: Evidence, files: bool) -> dict:
    from ..engines.qualification import evidence_state
    return {**evidence_state(e), "issuer": e.issuer, "issue_date": e.issue_date, "expiry_date": e.expiry_date,
            "batch_code": e.batch_code, "test_method": e.test_method, "extraction_method": e.extraction_method, "id": e.id, "type": e.type, "title": e.title, "filename": e.filename if files else None, "has_file": bool(e.stored_name),
            "file_accessible": files and bool(e.stored_name), "size_bytes": e.size_bytes, "linked_properties": e.linked_properties,
            "reported_values": e.reported_values, "status": e.status, "verified_by": e.verified_by, "notes": e.notes,
            "uploaded_at": e.uploaded_at}


@router.get("/materials/{sid}")
def passport(sid: int, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    s = _stream(db, sid)
    ind = db.get(Industry, s.industry_id)
    ev = db.query(Evidence).filter_by(waste_stream_id=s.id).order_by(Evidence.id).all()
    comp, src = effective_properties(s, ev)
    name = canonical(s.waste_name)
    uses = [{"industry_type": d["industry_type"], "raw_material": d["raw_material"], "required_spec": d["required_spec"],
             "processing": processing_steps(name, d["raw_material"], comp)} for d in kb.demand_kb() if name in d["accepted_substitutes"]]
    matches = [m for m in queries.all_matches(db) if m["waste_stream_id"] == s.id]
    best = max(matches, key=lambda m: m["net_saving_per_year"], default=None)
    unit = "MWh" if s.category == "energy" else "t"
    labels = [TRUST_LABEL.get(s.verification_status, s.verification_status.upper())]
    if not any(e.type in ("lab_report", "third_party_assessment") and e.status != "rejected" for e in ev):
        labels.append("REQUIRES EVIDENCE")
    files = _can_read_files(db, user, s)
    return {
        "id": s.id, "material": s.waste_name, "category": s.category, "physical_state": s.physical_state or ("energy" if s.category == "energy" else None),
        "owner": _is_owner(user, s),
        "company": privacy.mask_node(industry_dict(ind)),
        "quantity": {"value": s.monthly_tonnes, "unit": f"{unit}/month",
                     "source": "USER DECLARED" if s.verification_status in ("user_declared", "verified") else "AI INFERRED",
                     "confidence": s.confidence},
        "availability": {"seasonality": s.seasonality, "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]},
        "trust": {"status": s.verification_status, "labels": labels, "source": s.source, "confidence": s.confidence,
                  "reasoning": s.reasoning, "assumptions": s.assumptions or []},
        "properties": [{"property": k, "label": plabel(k), "value": v, "source": src.get(k, "ai_inferred")} for k, v in comp.items()],
        "hazardous": s.hazardous, "regulatory": regulatory_flags(name, s.hazardous),
        "applications": uses,
        "economics": {"disposal_cost_per_unit": s.disposal_cost_per_tonne, "basis": "ESTIMATE",
                      "best_match_value_per_year": best["net_saving_per_year"] if best else 0, "match_count": len(matches)},
        "environment": {"best_co2_per_year": best["co2_saved_per_year"] if best else 0},
        "top_matches": privacy.mask_matches(sorted(matches, key=lambda m: -m["score"])[:5]),
        "evidence": [evidence_out(e, files) for e in ev],
        "supply": supply_panel(db, s, None),
        "track_record": track_record(db, s.industry_id),
    }


class MaterialUpdate(BaseModel):
    monthly_tonnes: float | None = Field(None, gt=0, le=10_000_000)
    properties: dict[str, float] = {}
    physical_state: str | None = Field(None, max_length=30)
    confirm_availability: bool = False


@router.patch("/materials/{sid}")
def update_material(sid: int, body: MaterialUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Owner lists / corrects its material: values become USER REPORTED, never 'verified'."""
    s = _stream(db, sid)
    if not _is_owner(user, s):
        raise HTTPException(403, "Only the generating company can edit this material")
    if body.monthly_tonnes:
        s.monthly_tonnes = body.monthly_tonnes
    if body.properties:
        s.composition = {**(s.composition or {}), **body.properties}
        s.property_sources = {**(s.property_sources or {}), **{k: "user_reported" for k in body.properties}}
    if body.physical_state:
        s.physical_state = body.physical_state
    if body.confirm_availability or body.monthly_tonnes or body.properties:
        s.availability_updated_at = now_iso()
        if s.verification_status != "verified":
            s.verification_status = "user_declared"
        if s.source != "declared":
            s.assumptions = [a for a in (s.assumptions or []) if not a.startswith("Quantity")] + ["Quantity confirmed by the company"]
    db.commit()
    compute_all_matches(db)
    queries.invalidate()
    return passport(sid, user, db)


@router.get("/materials/{sid}/pathways")
def pathways(sid: int, db: Session = Depends(get_db)):
    """Every reuse route for one material, compared on the same facts. No 'best' label on purpose."""
    s = _stream(db, sid)
    name = canonical(s.waste_name)
    unit = "MWh" if s.category == "energy" else "t"
    from ..services import load_candidates
    cands = [c for c in load_candidates(db) if c["waste_stream_id"] == s.id]
    co2_max = scoring.co2_normaliser(load_candidates(db))
    groups: dict[str, list] = {}
    for c in cands:
        groups.setdefault(c["material"], []).append((c, scoring.score_one(c, scoring.Params(), co2_max)))
    out = []
    for material, rows in groups.items():
        viable = [sc for _, sc in rows if sc]
        best = max(viable, key=lambda m: m["net_saving_per_year"], default=None)
        c0 = min(rows, key=lambda r: r[0]["distance_km"])[0]
        out.append({
            "application": material, "kind": "network", "buyers_in_network": len(viable), "candidate_buyers": len(rows),
            "technical_fit": round(max(c["technical_fit"] for c, _ in rows), 3),
            "processing": c0["processing_steps"], "processing_cost": c0["processing_cost"],
            "nearest_km": round(min(c["distance_km"] for c, _ in rows), 1),
            "value_per_unit": round(best["saving_per_tonne"]) if best else None,
            "value_per_year": best["net_saving_per_year"] if best else 0,
            "co2_per_year": best["co2_saved_per_year"] if best else 0,
            "evidence": ["Composition lab report"] + (["SDS / contamination analysis", "MPCB authorisation"] if s.hazardous else []),
            "regulatory": c0["regulatory_flags"], "basis": "ESTIMATE from registered buyers",
        })
    for p in load_json("pathways.json")["pathways"]:
        if p["waste_name"] != name:
            continue
        cost = sum(c for _, c in p["processing"])
        per = p["value_per_tonne"] - cost + (s.disposal_cost_per_tonne or 0)
        out.append({
            "application": p["application"], "kind": "market", "buyers_in_network": 0, "candidate_buyers": 0,
            "technical_fit": p["technical_fit"], "processing": [{"step": a, "cost_per_tonne": b} for a, b in p["processing"]],
            "processing_cost": cost, "nearest_km": None, "value_per_unit": per,
            "value_per_year": round(per * s.monthly_tonnes * 12), "co2_per_year": round(p["virgin_co2_per_tonne"] * s.monthly_tonnes * 12, 1),
            "evidence": p["evidence"], "regulatory": p["regulatory"], "basis": "MARKET ESTIMATE, no registered buyer yet",
        })
    return {"material": s.waste_name, "unit": unit, "monthly_tonnes": s.monthly_tonnes, "pathways": out,
            "note": "Values are indicative estimates to compare routes, not quotes. The choice depends on your priorities."}


@router.post("/materials/{sid}/evidence")
async def upload_evidence(sid: int, type: str = Form(...), title: str = Form(..., max_length=200),
                          linked_properties: str = Form(""), reported_values: str = Form("{}"), notes: str = Form(""),
                          issuer: str = Form("", max_length=160), issue_date: str = Form(""), expiry_date: str = Form(""),
                          batch_code: str = Form("", max_length=60), test_method: str = Form("", max_length=120),
                          extraction_method: str = Form("manual", max_length=30),
                          file: UploadFile | None = File(None), user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _stream(db, sid)
    if not _is_owner(user, s):
        raise HTTPException(403, "Only the generating company can add evidence")
    if type not in EVIDENCE_TYPES:
        raise HTTPException(400, f"Unknown evidence type. Use one of: {', '.join(sorted(EVIDENCE_TYPES))}")
    try:
        values = {k: float(v) for k, v in json.loads(reported_values or "{}").items()}
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "reported_values must be a JSON object of numbers")
    props = [p.strip() for p in linked_properties.split(",") if p.strip()][:20]
    from datetime import date as _date
    for label, v in (("issue_date", issue_date), ("expiry_date", expiry_date)):
        if v:
            try:
                _date.fromisoformat(v)
            except ValueError:
                raise HTTPException(400, f"{label} must be YYYY-MM-DD")
    ev = Evidence(waste_stream_id=s.id, uploaded_by_industry_id=user.industry_id, type=type, title=title.strip(),
                  linked_properties=sorted(set(props) | set(values)), reported_values=values, notes=notes[:2000] or None,
                  status="submitted", uploaded_at=now_iso(), issuer=issuer.strip() or None, issue_date=issue_date or None,
                  expiry_date=expiry_date or None, batch_code=batch_code.strip() or None, test_method=test_method.strip() or None,
                  extraction_method=extraction_method if extraction_method in ("pdf_text", "csv", "text", "llm", "manual") else "manual")
    if file is not None and file.filename:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED:
            raise HTTPException(400, "Only PDF, PNG, JPG, CSV or TXT files are accepted")
        data = await file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "File is larger than 5 MB")
        magic = ALLOWED[ext]
        if magic and not data.startswith(magic):
            raise HTTPException(400, "File content does not match its extension")
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        stored = secrets.token_hex(16) + ext
        (UPLOAD_DIR / stored).write_bytes(data)
        ev.filename, ev.stored_name, ev.content_type, ev.size_bytes = Path(file.filename).name[:200], stored, file.content_type, len(data)
    db.add(ev)
    notify(db, kind="evidence", title=f"Evidence to review: {s.waste_name}", body=f"{ev.title} ({type.replace('_', ' ')}) was submitted and needs verification.",
           link=f"/material/{s.id}", facilitators=True, exclude_user=user.id)
    db.commit()
    return evidence_out(ev, True)


@router.get("/evidence/{eid}/file")
def evidence_file(eid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e = db.get(Evidence, eid)
    if not e or not e.stored_name:
        raise HTTPException(404, "File not found")
    if not _can_read_files(db, user, db.get(WasteStream, e.waste_stream_id)):
        raise HTTPException(403, "Evidence files are shared only after mutual consent")
    return FileResponse(UPLOAD_DIR / e.stored_name, filename=e.filename, media_type=e.content_type or "application/octet-stream")


class VerifyBody(BaseModel):
    status: str
    notes: str | None = Field(None, max_length=2000)


@router.post("/evidence/{eid}/verify")
def verify_evidence(eid: int, body: VerifyBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != "facilitator":
        raise HTTPException(403, "Only a platform facilitator can verify evidence")
    if body.status not in ("verified", "rejected"):
        raise HTTPException(400, "Status must be verified or rejected")
    e = db.get(Evidence, eid)
    if not e:
        raise HTTPException(404, "Evidence not found")
    e.status, e.verified_by, e.notes = body.status, user.contact_name, body.notes or e.notes
    s = db.get(WasteStream, e.waste_stream_id)
    if body.status == "verified" and s.verification_status == "user_declared" and e.type in ("lab_report", "third_party_assessment"):
        s.verification_status = "verified"
    notify(db, kind="evidence", title=f"Evidence {'accepted' if body.status == 'verified' else 'rejected'}: {s.waste_name}",
           body=f"{e.title} was {'verified' if body.status == 'verified' else 'rejected'} by the facilitator" + (f": {body.notes}" if body.notes else "."),
           link=f"/material/{s.id}", industry_ids=[s.industry_id], exclude_user=user.id)
    db.commit()
    return evidence_out(e, True)


@router.get("/evidence/pending")
def pending_evidence(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Facilitator queue: evidence submitted by companies and awaiting verification."""
    if user.role != "facilitator":
        raise HTTPException(403, "Facilitators only")
    out = []
    for e in db.query(Evidence).filter_by(status="submitted").order_by(Evidence.id.desc()).all():
        s = db.get(WasteStream, e.waste_stream_id)
        out.append({**evidence_out(e, True), "waste_stream_id": s.id, "material": s.waste_name, "company": db.get(Industry, s.industry_id).name})
    return out



@router.get("/materials/{sid}/supply")
def supply(sid: int, db: Session = Depends(get_db)):
    return supply_panel(db, _stream(db, sid), None)


class AvailabilityBody(BaseModel):
    available_tonnes: float = Field(gt=0, le=10_000_000)
    min_order_tonnes: float | None = Field(None, ge=0)
    delivery_window: str | None = Field(None, max_length=120)


@router.post("/materials/{sid}/availability")
def refresh_availability(sid: int, body: AvailabilityBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Owner confirms what is available this month: timestamped, added to supply history."""
    from ..models import SupplyRecord
    s = _stream(db, sid)
    if not _is_owner(user, s):
        raise HTTPException(403, "Only the generating company can update availability")
    month = now_iso()[:7]
    rec = db.query(SupplyRecord).filter_by(waste_stream_id=s.id, month=month).first()
    if rec:
        rec.available_tonnes, rec.source, rec.recorded_at = body.available_tonnes, "reported", now_iso()
    else:
        db.add(SupplyRecord(waste_stream_id=s.id, month=month, available_tonnes=body.available_tonnes, source="reported", recorded_at=now_iso()))
    s.monthly_tonnes, s.availability_updated_at = body.available_tonnes, now_iso()
    s.min_order_tonnes = body.min_order_tonnes if body.min_order_tonnes is not None else s.min_order_tonnes
    s.delivery_window = body.delivery_window or s.delivery_window
    if s.verification_status != "verified":
        s.verification_status = "user_declared"
    db.commit()
    compute_all_matches(db)
    queries.invalidate()
    return supply_panel(db, s, None)



# ---------------------------------------------------------------- document extraction
@router.post("/evidence/extract")
async def extract_document(file: UploadFile = File(...), user: User = Depends(current_user)):
    """Read a lab report and suggest property values, issuer, date, batch and method. Nothing is stored."""
    from ..engines.extraction import extract
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, "Only PDF, PNG, JPG, CSV or TXT files are accepted")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File is larger than 5 MB")
    if ALLOWED[ext] and not data.startswith(ALLOWED[ext]):
        raise HTTPException(400, "File content does not match its extension")
    return extract(data, ext)


# ---------------------------------------------------------------- photos: supply and requirement images
IMAGE_EXT = {".png": b"\x89PNG", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".webp": b"RIFF"}
IMAGE_DIR = UPLOAD_DIR / "images"


def image_out(im) -> dict:
    return {"id": im.id, "role": im.role, "waste_stream_id": im.waste_stream_id, "demand_id": im.demand_id, "url": f"/api/images/{im.id}/file",
            "width": im.width, "height": im.height, "caption": im.caption, "traits": im.traits, "predicted": im.predicted,
            "synthetic": im.synthetic, "created_at": im.created_at, "has_embedding": bool(im.embedding)}


async def _store_image(file: UploadFile) -> tuple:
    from ..engines import vision
    ext = Path(file.filename or "").suffix.lower()
    if ext not in IMAGE_EXT:
        raise HTTPException(400, "Photos must be JPG, PNG or WEBP")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Photo is larger than 5 MB")
    if not data.startswith(IMAGE_EXT[ext]):
        raise HTTPException(400, "File content does not match its extension")
    try:
        img = vision.load(data)
    except Exception:
        raise HTTPException(400, "Could not read the image")
    feats, traits = vision.descriptor(img)
    emb = vision.clip_embed(img)
    predicted = vision.zero_shot(emb, kb.waste_vocabulary())
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    stored = secrets.token_hex(16) + ".jpg"
    (IMAGE_DIR / stored).write_bytes(vision.sanitized_jpeg(img))  # metadata (EXIF/GPS) stripped
    return stored, img.size, feats, traits, emb, predicted


@router.post("/materials/{sid}/images")
async def upload_supply_image(sid: int, file: UploadFile = File(...), caption: str = Form("", max_length=200),
                              user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..models import MaterialImage
    s = _stream(db, sid)
    if not _is_owner(user, s):
        raise HTTPException(403, "Only the generating company can add photos of this material")
    stored, (w, h), feats, traits, emb, predicted = await _store_image(file)
    im = MaterialImage(role="supply", waste_stream_id=s.id, owner_industry_id=user.industry_id, stored_name=stored, content_type="image/jpeg",
                       width=w, height=h, caption=caption or None, features=feats, traits=traits, embedding=emb, predicted=predicted, created_at=now_iso())
    db.add(im)
    db.commit()
    return image_out(im)


@router.post("/demands/{did}/images")
async def upload_requirement_image(did: int, file: UploadFile = File(...), caption: str = Form("", max_length=200),
                                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Buyer adds a photo of the material it uses today / needs (reference for visual matching)."""
    from ..models import Demand, MaterialImage
    d = db.get(Demand, did)
    if not d or d.industry_id != user.industry_id:
        raise HTTPException(404, "Requirement not found")
    stored, (w, h), feats, traits, emb, predicted = await _store_image(file)
    im = MaterialImage(role="requirement", demand_id=d.id, owner_industry_id=user.industry_id, stored_name=stored, content_type="image/jpeg",
                       width=w, height=h, caption=caption or None, features=feats, traits=traits, embedding=emb, predicted=predicted, created_at=now_iso())
    db.add(im)
    db.commit()
    return image_out(im)


@router.get("/materials/{sid}/images")
def supply_images(sid: int, db: Session = Depends(get_db)):
    from ..models import MaterialImage
    return [image_out(i) for i in db.query(MaterialImage).filter_by(waste_stream_id=sid, role="supply").order_by(MaterialImage.id).all()]


@router.get("/demands/{did}/images")
def requirement_images(did: int, db: Session = Depends(get_db)):
    from ..models import MaterialImage
    return [image_out(i) for i in db.query(MaterialImage).filter_by(demand_id=did, role="requirement").order_by(MaterialImage.id).all()]


@router.get("/images/{iid}/file")
def image_file(iid: int, db: Session = Depends(get_db)):
    from ..models import MaterialImage
    im = db.get(MaterialImage, iid)
    if not im:
        raise HTTPException(404, "Image not found")
    return FileResponse(IMAGE_DIR / im.stored_name, media_type="image/jpeg")


@router.delete("/images/{iid}")
def delete_image(iid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..models import MaterialImage
    im = db.get(MaterialImage, iid)
    if not im or im.owner_industry_id != user.industry_id:
        raise HTTPException(404, "Image not found")
    (IMAGE_DIR / im.stored_name).unlink(missing_ok=True)
    db.delete(im)
    db.commit()
    return {"ok": True}
