"""Processing facilities (missing-link registry) and the emission-factor registry."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import queries
from ..auth import current_user, now_iso
from ..database import get_db
from ..engines import kb
from ..engines.routes import processor_out
from ..factors import apply_to_scoring, registry
from ..models import EmissionFactor, Industry, Processor, User
from ..services import compute_all_matches

router = APIRouter(tags=["processors"])
PROPS = {"CaO", "SiO2", "Al2O3", "Fe2O3", "moisture", "purity_pct", "calorific_value_MJkg", "organic_pct", "acid_pct", "K2O_pct", "CO2_pct", "temperature_C", "Fe_pct"}


class ProcessorBody(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    cluster: str
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    accepts: list[str] = Field(min_length=1, max_length=12)
    output_label: str = Field(min_length=3, max_length=160)
    sets: dict[str, float] = {}
    yield_share: float = Field(gt=0, le=1)
    cost_per_tonne: float = Field(ge=0, le=100000)
    capacity_tpm: float = Field(gt=0, le=10_000_000)
    steps: list[str] = Field(min_length=1, max_length=8)
    energy_kwh_per_tonne: float | None = Field(None, ge=0, le=5000)
    hazardous_permitted: bool = False


def _validate(db: Session, b: ProcessorBody) -> tuple[float, float]:
    vocab = set(kb.waste_vocabulary())
    bad = [a for a in b.accepts if a not in vocab]
    if bad:
        raise HTTPException(400, f"Unknown input material(s): {', '.join(bad)}")
    if set(b.sets) - PROPS:
        raise HTTPException(400, f"Unknown output properties: {', '.join(set(b.sets) - PROPS)}")
    if b.lat is not None and b.lon is not None:
        return b.lat, b.lon
    members = [i for i in db.query(Industry).filter_by(cluster=b.cluster).all()]
    if not members:
        raise HTTPException(400, "Unknown cluster; give lat/lon")
    return sum(i.lat for i in members) / len(members), sum(i.lon for i in members) / len(members)


@router.get("/processors")
def list_processors(db: Session = Depends(get_db)):
    rows = [processor_out(p) for p in db.query(Processor).order_by(Processor.source, Processor.cluster).all()]
    return {"processors": rows, "input_materials": kb.waste_vocabulary(), "properties": sorted(PROPS)}


@router.post("/processors")
def register(b: ProcessorBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A processing operator (or facilitator) registers a facility; routes use it immediately as 'unconfirmed'."""
    lat, lon = _validate(db, b)
    p = Processor(name=b.name, cluster=b.cluster, lat=lat, lon=lon, accepts=b.accepts, output_label=b.output_label, sets=b.sets,
                  yield_share=b.yield_share, cost_per_tonne=b.cost_per_tonne, capacity_tpm=b.capacity_tpm, steps=b.steps,
                  energy_kwh_per_tonne=b.energy_kwh_per_tonne, hazardous_permitted=b.hazardous_permitted, unresolved=[],
                  operator_industry_id=user.industry_id, source="registered", status="unconfirmed", updated_at=now_iso())
    db.add(p)
    db.commit()
    return processor_out(p)


def _own(db: Session, pid: int, user: User) -> Processor:
    p = db.get(Processor, pid)
    if not p:
        raise HTTPException(404, "Processor not found")
    if user.role != "facilitator" and (p.operator_industry_id is None or p.operator_industry_id != user.industry_id):
        raise HTTPException(403, "Only the operator or a facilitator can change this facility")
    return p


@router.patch("/processors/{pid}")
def update(pid: int, b: ProcessorBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = _own(db, pid, user)
    p.lat, p.lon = _validate(db, b)
    for k in ("name", "cluster", "accepts", "output_label", "sets", "yield_share", "cost_per_tonne", "capacity_tpm", "steps", "energy_kwh_per_tonne", "hazardous_permitted"):
        setattr(p, k, getattr(b, k))
    p.status, p.updated_at = "unconfirmed", now_iso()  # changed figures need re-confirmation
    db.commit()
    return processor_out(p)


@router.post("/processors/{pid}/confirm")
def confirm(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Operator confirms capacity, yield and gate fee as current quotes (a facilitator may confirm on their behalf)."""
    p = _own(db, pid, user)
    if p.source == "synthetic" and user.role != "facilitator":
        raise HTTPException(403, "Example facilities can only be confirmed by a facilitator")
    p.status, p.updated_at = "confirmed", now_iso()
    if p.source == "synthetic":
        p.source = "registered"
    db.commit()
    return processor_out(p)


# ---------------------------------------------------------------- factor registry
@router.get("/factors")
def factors(db: Session = Depends(get_db)):
    return {"factors": list(registry(db).values()),
            "note": "Factors marked 'default' are planning values; a facilitator should review them against current published sources before results are reported."}


class FactorBody(BaseModel):
    value: float = Field(gt=0, le=100000)
    source: str = Field(min_length=5, max_length=500)
    reference_year: str | None = Field(None, max_length=20)


@router.patch("/factors/{key}")
def update_factor(key: str, b: FactorBody, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role != "facilitator":
        raise HTTPException(403, "Only a facilitator can update emission factors")
    f = db.get(EmissionFactor, key)
    if not f:
        raise HTTPException(404, "Unknown factor")
    f.value, f.source, f.reference_year = b.value, b.source, b.reference_year or f.reference_year
    f.status, f.updated_by, f.updated_at = "reviewed", user.contact_name, now_iso()
    db.commit()
    apply_to_scoring(db)
    compute_all_matches(db)  # CO2 in matches, simulator and impact follow the new factor
    queries.invalidate()
    return registry(db)[key]
