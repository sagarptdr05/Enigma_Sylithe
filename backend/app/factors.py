"""Factor registry access (DB-backed, seeded from engines.impact.DEFAULT_FACTORS)."""
from sqlalchemy.orm import Session

from .auth import now_iso
from .engines import impact, scoring
from .models import EmissionFactor


def seed_factors(db: Session) -> None:
    have = {f.key for f in db.query(EmissionFactor).all()}
    for k, d in impact.defaults().items():
        if k not in have:
            db.add(EmissionFactor(key=k, label=d["label"], value=d["value"], unit=d["unit"], source=d["source"],
                                  reference_year=d["reference_year"], status="default", updated_at=now_iso()))
    db.commit()


def registry(db: Session) -> dict[str, dict]:
    f = impact.defaults()
    for r in db.query(EmissionFactor).all():
        f[r.key] = {"key": r.key, "label": r.label, "value": r.value, "unit": r.unit, "source": r.source,
                    "reference_year": r.reference_year, "status": r.status, "updated_by": r.updated_by, "updated_at": r.updated_at}
    return f


def apply_to_scoring(db: Session) -> None:
    """Matches, simulator and impact use the same transport factor."""
    scoring.TRANSPORT_CO2_PER_KM = impact.transport_factor(registry(db))
