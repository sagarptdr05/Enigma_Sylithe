"""Photo-based matching. Visual similarity helps buyers recognise a usable material, but it is indicative only:
specification, evidence and tests decide eligibility, so spec fit carries most of the ranking weight."""
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..auth import current_user, optional_user
from ..buyer import cost_inputs
from ..database import get_db
from ..engines import kb, vision
from ..engines.assessment import assess
from ..engines.costing import landed_cost
from ..engines.qualification import eligibility
from ..models import Demand, Evidence, Match, MaterialImage, User, WasteStream
from ..services import load_candidates
from .materials import IMAGE_EXT, MAX_BYTES, image_out

router = APIRouter(tags=["visual"])
W_SPEC, W_VISUAL = 0.65, 0.35


def _conclusion(visual: float, el: str | None, checked: bool = True) -> str:
    look = "Looks very similar" if visual >= 0.75 else "Looks similar" if visual >= 0.5 else "Looks different"
    if not checked:
        return f"{look}. Not checked against a specification: pick one of your requirements to see if it qualifies. Appearance alone cannot qualify a material."
    if el is None:
        return f"{look}, but it is not compatible with your specification. Appearance alone cannot qualify a material."
    if el == "not_eligible":
        return f"{look}, but a critical specification check fails."
    if el == "conditional":
        return f"{look} and fits your specification with conditions open (tests or documents)."
    return f"{look} and meets your specification." + (" Appearance varies with moisture and particle size: rely on tests." if visual < 0.5 else "")


def rank_against(db: Session, refs: list, demand: Demand | None) -> list[dict]:
    """refs: requirement images (objects or dicts with features/embedding/traits)."""
    vision.ensure_embeddings(db)
    supply = db.query(MaterialImage).filter_by(role="supply").all()
    by_stream = defaultdict(list)
    for im in supply:
        by_stream[im.waste_stream_id].append(im)
    streams = {s.id: s for s in db.query(WasteStream).filter(WasteStream.id.in_(list(by_stream))).all()} if by_stream else {}
    inds = queries.industries_map(db)
    matches = {m.waste_stream_id: m for m in db.query(Match).filter(Match.demand_id == demand.id).all()} if demand else {}
    cand_ids = {c["waste_stream_id"] for c in load_candidates(db) if demand and c["demand_id"] == demand.id}
    rows = []
    for sid, ims in by_stream.items():
        s = streams.get(sid)
        if not s or (demand and s.industry_id == demand.industry_id):
            continue
        best, best_im, best_ref = None, None, None
        for im in ims:
            for ref in refs:
                sim = vision.similarity(ref, im)
                if best is None or sim["overall"] > best["overall"]:
                    best, best_im, best_ref = sim, im, ref
        el, m, lc, spec_score = None, matches.get(sid), None, None
        if demand and sid in cand_ids:
            ev = db.query(Evidence).filter_by(waste_stream_id=s.id).all()
            steps = m.processing_steps if m else []
            a = assess(ws=s, evidence=ev, spec=demand.spec or {}, material=demand.material, need_tonnes=demand.monthly_tonnes,
                       virgin_price=demand.virgin_price, virgin_co2=demand.virgin_co2, distance_km=m.distance_km if m else 0,
                       processing_steps=steps, regulatory_flags=m.regulatory_flags if m else [])
            el = eligibility(a)["status"]
            spec_score = (m.score / 100) if m else a["technical_fit"] * 0.8
            lc = landed_cost(cost_inputs(m))["cost_per_usable_tonne"] if m else None
        ref_traits = vision._get(best_ref, "traits") or {}
        rank = (W_SPEC * spec_score + W_VISUAL * best["overall"]) if spec_score is not None else best["overall"] * W_VISUAL * 0.5
        rows.append({
            "waste_stream_id": s.id, "material": s.waste_name, "trust": s.verification_status,
            "supplier": privacy.mask_node(queries.node(inds[s.industry_id])), "image": image_out(best_im),
            "visual": best, "traits": vision.compare_traits(ref_traits, best_im.traits or {}),
            "compatible": el is not None, "eligibility": el, "match_id": m.id if m else None,
            "match_score": round(m.score, 1) if m else None, "distance_km": round(m.distance_km, 1) if m else None,
            "landed_cost_per_usable_tonne": lc, "rank_score": round(rank * 100, 1), "conclusion": _conclusion(best["overall"], el, demand is not None),
            "spec_checked": demand is not None,
        })
    rows.sort(key=lambda r: (not r["compatible"], -r["rank_score"]))
    return rows


@router.get("/demands/{did}/visual-matches")
def visual_matches(did: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(Demand, did)
    if not d or (d.industry_id != user.industry_id and user.role != "facilitator"):
        raise HTTPException(404, "Requirement not found")
    refs = db.query(MaterialImage).filter_by(demand_id=d.id, role="requirement").all()
    if not refs:
        raise HTTPException(409, "Add a photo of the material you need first")
    return {"demand": {"id": d.id, "material": d.material, "monthly_tonnes": d.monthly_tonnes, "spec": d.spec},
            "reference_images": [image_out(r) for r in refs], "results": rank_against(db, refs, d)[:12],
            "method": vision.similarity(refs[0], refs[0])["method"],
            "weights": {"specification": W_SPEC, "visual": W_VISUAL},
            "note": "Visual similarity is indicative. Composition, evidence and trials decide whether a material can be used."}


@router.post("/vision/search")
async def photo_search(file: UploadFile = File(...), demand_id: int | None = Form(None),
                       user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    """Upload any photo: what does it look like, which listed materials look similar, and (for a buyer's
    requirement) which of them also meet the specification. The photo is not stored."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in IMAGE_EXT:
        raise HTTPException(400, "Photos must be JPG, PNG or WEBP")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or not data.startswith(IMAGE_EXT[ext]):
        raise HTTPException(400, "Invalid or too large photo")
    img = vision.load(data)
    feats, traits = vision.descriptor(img)
    emb = vision.clip_embed(img)
    ref = {"features": feats, "embedding": emb, "traits": traits}
    demand = None
    if demand_id is not None:
        demand = db.get(Demand, demand_id)
        if not demand or not user or demand.industry_id != user.industry_id:
            raise HTTPException(404, "Requirement not found")
    results = rank_against(db, [ref], demand)
    votes: dict[str, float] = defaultdict(float)
    for r in sorted(results, key=lambda r: -r["visual"]["overall"])[:5]:
        votes[r["material"]] += r["visual"]["overall"]
    total = sum(votes.values()) or 1
    nearest = [{"material": k, "score": round(v / total, 3), "method": "similar listed photos"} for k, v in sorted(votes.items(), key=lambda x: -x[1])[:3]]
    zs = vision.zero_shot(emb, kb.waste_vocabulary())
    predicted = zs or nearest
    return {"traits": traits, "predicted": predicted, "method": vision.similarity(ref, ref)["method"],
            "identification": ("CLIP recognition" if zs else "Nearest listed photos" if nearest else "Not enough labelled photos") +
                              (" (low confidence)" if predicted and predicted[0]["score"] < 0.5 else ""),
            "similar": sorted(results, key=lambda r: -r["visual"]["overall"])[:8] if demand is None else results[:10],
            "demand": {"id": demand.id, "material": demand.material} if demand else None,
            "note": "Visual similarity is indicative. Composition, evidence and trials decide whether a material can be used."}
