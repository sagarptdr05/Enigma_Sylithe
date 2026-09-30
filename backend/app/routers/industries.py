from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..buyer import track_record
from ..database import get_db
from ..engines import inference, kb, llm
from ..models import Industry
from ..schemas import IndustryCreate, InferRequest
from ..services import compute_matches_for_industry, industry_dict, populate_industry

router = APIRouter(tags=["industries"])


def default_unit(t: str) -> str:
    from ..data.seed import load_json
    for row in load_json("industries.json"):
        if row["type"] == t:
            return row["capacity_unit"]
    return "t/month"


@router.get("/meta")
def meta():
    types = kb.industry_types()
    return {"industry_types": [{"type": t, "capacity_unit": default_unit(t)} for t in types],
            "llm": llm.available(), "waste_vocabulary": kb.waste_vocabulary(),
            "raw_materials": sorted({d["raw_material"] for d in kb.demand_kb()})}


@router.get("/industries")
def list_industries(cluster: str | None = None, db: Session = Depends(get_db)):
    q = db.query(Industry)
    if cluster:
        q = q.filter(Industry.cluster == cluster)
    counts = defaultdict(int)
    for m in queries.all_matches(db):
        counts[m["src_id"]] += 1
        counts[m["dst_id"]] += 1
    return [privacy.mask_node({**industry_dict(i), "match_count": counts[i.id], "visibility": i.visibility,
                               "hidden_count": sum(1 for s in i.waste_streams if s.source != "declared")}) for i in q.all()]


def register_industry(db: Session, body: IndustryCreate) -> tuple[Industry, int]:
    """Create an industry, infer its waste streams/demands and compute its matches."""
    if body.type not in kb.industry_types():
        raise HTTPException(400, f"Unknown industry type '{body.type}'")
    data = body.model_dump(exclude={"declared_wastes"})
    data["capacity_unit"] = data["capacity_unit"] or default_unit(body.type)
    ind = Industry(**data)
    db.add(ind)
    db.flush()
    populate_industry(db, ind, body.declared_wastes)
    db.commit()
    n = compute_matches_for_industry(db, ind.id)
    queries.invalidate()
    return ind, n


@router.post("/industries")
def create_industry(body: IndustryCreate, db: Session = Depends(get_db)):
    ind, n = register_industry(db, body)
    return {**industry_dict(ind), "matches_created": n}


@router.get("/industries/{industry_id}")
def industry_detail(industry_id: int, db: Session = Depends(get_db)):
    ind = db.get(Industry, industry_id)
    if not ind:
        raise HTTPException(404, "Industry not found")
    matches = queries.all_matches(db)
    outgoing = defaultdict(list)
    for m in matches:
        if m["src_id"] == industry_id:
            outgoing[m["waste_stream_id"]].append(m)
    streams = [{**queries.stream_out(s), "top_matches": privacy.mask_matches(outgoing[s.id][:3]), "match_count": len(outgoing[s.id])}
               for s in ind.waste_streams]
    incoming = defaultdict(list)
    for m in matches:
        if m["dst_id"] == industry_id:
            incoming[m["demand_id"]].append(m)
    demands = [{**queries.demand_out(d), "top_suppliers": privacy.mask_matches(incoming[d.id][:3]), "supplier_count": len(incoming[d.id])}
               for d in ind.demands]
    return {
        **privacy.mask_node({**industry_dict(ind), "visibility": ind.visibility}), "waste_streams": streams, "demands": demands,
        "track_record": track_record(db, ind.id),
        "totals": {
            "outgoing_saving": sum(ms[0]["net_saving_per_year"] for ms in outgoing.values() if ms),
            "incoming_saving": sum(ms[0]["net_saving_per_year"] for ms in incoming.values() if ms),
            "hidden_streams": sum(1 for s in ind.waste_streams if s.source != "declared"),
        },
    }


@router.post("/infer")
def infer(body: InferRequest):
    fake = {"type": body.type, "capacity": body.capacity, "capacity_unit": default_unit(body.type),
            "process_description": body.text or ""}
    kb_items = inference.infer_from_kb(fake) if body.type in kb.industry_types() else []
    text_items = inference.infer_from_text(fake, kb_items)
    return {"llm": llm.available(), "items": kb_items + text_items}
