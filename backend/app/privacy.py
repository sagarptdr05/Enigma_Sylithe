"""Confidential identities. Masking happens server-side at serialization, so hidden names / exact
coordinates never reach the browser (JSON, map metadata or HTML) unless the viewer is allowed."""
from contextvars import ContextVar

from fastapi import Depends
from sqlalchemy.orm import Session

from .auth import optional_user
from .database import get_db
from .models import Industry, Inquiry, Match, User

_viewer: ContextVar[dict] = ContextVar("viewer", default={"industry": None, "facilitator": False, "revealed": set(), "confidential": set()})
MASK = "Confidential supplier"


def confidential_ids(db: Session) -> set[int]:
    return {i for (i,) in db.query(Industry.id).filter(Industry.visibility == "confidential").all()}


def revealed_for(db: Session, industry_id: int | None) -> set[int]:
    """Industries whose identity this viewer may see: themselves + mutual-consent counterparties."""
    if industry_id is None:
        return set()
    out = {industry_id}
    rows = db.query(Inquiry).filter(((Inquiry.from_industry_id == industry_id) | (Inquiry.to_industry_id == industry_id))
                                    & Inquiry.supplier_consent.is_(True) & Inquiry.buyer_consent.is_(True)).all()
    for q in rows:
        out.add(q.from_industry_id)
        out.add(q.to_industry_id)
    return out


async def privacy_context(user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    """App-wide dependency: records who is looking so serializers can mask."""
    ind = user.industry_id if user else None
    _viewer.set({"industry": ind, "facilitator": bool(user and user.role == "facilitator"),
                 "revealed": revealed_for(db, ind), "confidential": confidential_ids(db)})


def can_see(industry_id: int | None) -> bool:
    v = _viewer.get()
    return industry_id is None or industry_id not in v["confidential"] or v["facilitator"] or industry_id in v["revealed"]


def is_facilitator() -> bool:
    return _viewer.get()["facilitator"]


def hide_node(n: dict) -> dict:
    """Full hide (inside an exchange before mutual consent): no coordinates at all."""
    return {"id": n["id"], "type": n.get("type"), "cluster": n.get("cluster"), "name": MASK, "confidential": True, "hidden": True,
            "lat": None, "lon": None, "address": _region(n.get("cluster"))}


def is_confidential(industry_id: int) -> bool:
    return industry_id in _viewer.get()["confidential"]


def _region(cluster: str | None) -> str:
    return (cluster or "").replace(" MIDC", "").replace(" Agro Belt", "").replace(" Urban", "") + " region"


def mask_node(n: dict | None) -> dict | None:
    """Industry-like dict (id, name, lat, lon, ...) -> masked copy when the viewer may not see it."""
    if not n or not is_confidential(n.get("id", -1)):
        return n
    if can_see(n.get("id")):
        return {**n, "confidential": True}
    out = {**n, "name": MASK, "confidential": True, "hidden": True, "address": _region(n.get("cluster")),
           "lat": round(n["lat"] * 20) / 20 if n.get("lat") is not None else None,  # ~5 km grid
           "lon": round(n["lon"] * 20) / 20 if n.get("lon") is not None else None}
    for k in ("process_description", "email", "phone", "contact_name"):
        out.pop(k, None)
    return out


def mask_match(m: dict) -> dict:
    src, dst = m.get("source"), m.get("buyer")
    if (src and is_confidential(src.get("id", -1))) or (dst and is_confidential(dst.get("id", -1))):
        return {**m, "source": mask_node(src), "buyer": mask_node(dst)}
    return m


def mask_matches(ms: list[dict]) -> list[dict]:
    return [mask_match(m) for m in ms]


def mask_loop(l: dict) -> dict:
    members = [mask_node({**x, "lat": None, "lon": None}) for x in l["members"]]
    names = {x["id"]: x["name"] for x in members}
    edges = [{**e, "source_name": names.get(e["source"], e["source_name"]), "target_name": names.get(e["target"], e["target_name"])} for e in l["edges"]]
    return {**l, "members": [{k: v for k, v in x.items() if k not in ("lat", "lon")} for x in members], "edges": edges}


def match_parties(m: Match) -> tuple[int, int]:
    return m.waste_stream.industry_id, m.demand.industry_id
