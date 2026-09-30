from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import privacy, queries
from ..auth import optional_user
from ..database import get_db
from ..engines.discovery import discover
from ..models import Demand, Industry, Match, User

router = APIRouter(prefix="/alternatives", tags=["alternatives"])


class DiscoverBody(BaseModel):
    intended_use: str = Field(min_length=2, max_length=200)
    current_material: str = Field("", max_length=120)
    monthly_tonnes: float = Field(gt=0, le=10_000_000)
    cluster: str | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    max_distance: float = Field(150, gt=0, le=1000)
    current_price: float | None = Field(None, gt=0)
    required_spec: dict[str, tuple[float, float]] = {}
    process_description: str | None = Field(None, max_length=2000)


def locate(db: Session, body, user: User | None) -> tuple[float, float, str]:
    if body.lat is not None and body.lon is not None:
        return body.lat, body.lon, "pinned location"
    if user and user.industry_id and not body.cluster:
        ind = db.get(Industry, user.industry_id)
        return ind.lat, ind.lon, ind.name
    c = next((c for c in _centres(db) if c["name"] == body.cluster), None)
    if not c:
        raise HTTPException(400, "Give a cluster, a location, or log in")
    return c["lat"], c["lon"], c["name"]


def _centres(db: Session) -> list[dict]:
    inds = queries.industries_map(db).values()
    out = {}
    for d in inds:
        out.setdefault(d["cluster"], []).append(d)
    return [{"name": k, "lat": sum(x["lat"] for x in v) / len(v), "lon": sum(x["lon"] for x in v) / len(v)} for k, v in out.items()]


def attach_match_ids(db: Session, result: dict, industry_id: int | None) -> None:
    """If the viewer buys the target material, link each stream to the existing match so they can open an exchange."""
    if not industry_id:
        return
    dem = {d.id for d in db.query(Demand).filter(Demand.industry_id == industry_id, Demand.material == result["raw_material"]).all()}
    if not dem:
        return
    sids = [s["waste_stream_id"] for a in result["alternatives"] for s in a["streams"]]
    pairs = {m.waste_stream_id: m.id for m in db.query(Match).filter(Match.waste_stream_id.in_(sids), Match.demand_id.in_(dem)).all()}
    for a in result["alternatives"]:
        for s in a["streams"]:
            s["match_id"] = pairs.get(s["waste_stream_id"])


def mask_result(result: dict) -> dict:
    for a in result["alternatives"]:
        for s in a["streams"]:
            s["industry"] = privacy.mask_node(s["industry"])
    for row in result.get("supply_plan", {}).get("plan", []):
        row["industry"] = privacy.mask_node(row["industry"])
    for r in result.get("routes", []):
        r["source"] = privacy.mask_node(r["source"])
    return result


@router.post("/discover")
def discover_alternatives(body: DiscoverBody, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    lat, lon, where = locate(db, body, user)
    res = discover(db, intended_use=body.intended_use, current_material=body.current_material, monthly_tonnes=body.monthly_tonnes,
                   lat=lat, lon=lon, max_distance=body.max_distance, current_price=body.current_price,
                   required_spec={k: list(v) for k, v in body.required_spec.items()}, exclude_industry=user.industry_id if user else None)
    attach_match_ids(db, res, user.industry_id if user else None)
    res["location"] = {"lat": lat, "lon": lon, "label": where}
    res["pipeline"] = ["Semantic candidate discovery", "Property compatibility", "Quantity feasibility", "Location feasibility",
                       "Processing feasibility", "Regulatory feasibility", "Evidence completeness", "Economic feasibility",
                       "Environmental impact", "Final prioritisation"]
    return mask_result(res)
