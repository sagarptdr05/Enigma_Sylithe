"""True landed cost per USABLE tonne (not per quoted tonne). Pure functions, reused by match pages,
backup finder, missing-link routes and the Time Machine."""
from dataclasses import asdict, dataclass

# indicative defaults (INR per delivered tonne unless stated) - every one is shown to the user as an assumption
DEFAULTS = {"loading_unloading": 60.0, "handling": 40.0, "storage": 30.0, "testing_per_month": 15000.0, "other": 0.0,
            "acceptance_yield": 0.97}
STEP_YIELD = {"dry": 0.92, "wash": 0.95, "magnetic": 0.9, "separation": 0.9, "grind": 0.99, "screen": 0.97, "crush": 0.99,
              "composting": 0.7, "pelletis": 0.9, "de-oil": 0.98, "regeneration": 0.85, "re-concentration": 0.85, "depith": 0.85,
              "sorting": 0.95, "dewater": 0.8}
EXCLUSIONS = ["Buyer's internal quality-control labour", "Capital cost of new storage or feeding equipment",
              "Financing / working-capital cost", "Taxes and statutory levies"]


def processing_yield(steps: list[dict]) -> float:
    y = 1.0
    for s in steps:
        name = s["step"].lower()
        y *= next((v for k, v in STEP_YIELD.items() if k in name), 1.0)
    return round(y, 4)


@dataclass
class CostInputs:
    material_price: float | None  # price paid to supplier per delivered tonne
    material_price_basis: str  # ESTIMATE | USER PROVIDED
    distance_km: float
    transport_rate: float = 4.5
    diesel_multiplier: float = 1.0
    loading_unloading: float = DEFAULTS["loading_unloading"]
    handling: float = DEFAULTS["handling"]
    storage: float = DEFAULTS["storage"]
    processing: float = 0.0
    testing_per_month: float = DEFAULTS["testing_per_month"]
    other: float = DEFAULTS["other"]
    monthly_tonnes: float | None = None  # delivered tonnes per month
    acceptance_yield: float = DEFAULTS["acceptance_yield"]
    processing_yield: float = 1.0
    baseline_price: float | None = None  # conventional material, delivered, per usable tonne


def landed_cost(ci: CostInputs) -> dict:
    missing = [k for k in ("material_price", "monthly_tonnes", "baseline_price") if getattr(ci, k) in (None, 0)]
    if ci.acceptance_yield <= 0 or ci.processing_yield <= 0:
        missing.append("yield")
    transport = ci.distance_km * ci.transport_rate * ci.diesel_multiplier
    testing = (ci.testing_per_month / ci.monthly_tonnes) if ci.monthly_tonnes else 0.0
    rejected_share = 1 - ci.acceptance_yield
    rejected_return = rejected_share * transport  # rejected loads travel back (or to disposal)
    lines = [
        ("Material price", ci.material_price or 0.0, ci.material_price_basis),
        ("Transport", transport, "ESTIMATE"), ("Loading / unloading", ci.loading_unloading, "ESTIMATE"),
        ("Handling", ci.handling, "ESTIMATE"), ("Storage (1 month)", ci.storage, "ESTIMATE"),
        ("Processing", ci.processing, "ESTIMATE"), ("Testing", testing, "ESTIMATE"),
        ("Rejected-load return", rejected_return, "ESTIMATE"), ("Other", ci.other, "USER PROVIDED" if ci.other else "ESTIMATE"),
    ]
    per_delivered = sum(v for _, v, _ in lines)
    usable_share = ci.acceptance_yield * ci.processing_yield
    per_usable = per_delivered / usable_share if usable_share > 0 else None
    usable_tonnes = (ci.monthly_tonnes or 0) * usable_share
    result = {
        "inputs": asdict(ci), "lines": [{"label": l, "per_delivered_tonne": round(v, 2), "basis": b} for l, v, b in lines],
        "cost_per_delivered_tonne": round(per_delivered, 2), "usable_share": round(usable_share, 4),
        "usable_tonnes_per_month": round(usable_tonnes, 1),
        "cost_per_usable_tonne": round(per_usable, 2) if per_usable else None,
        "baseline_per_usable_tonne": ci.baseline_price, "missing": missing, "exclusions": EXCLUSIONS,
        "formula": "Landed cost per usable tonne = (material + transport + loading + handling + storage + processing + testing + rejected-load return + other) / (acceptance yield x processing yield)",
    }
    if missing or per_usable is None:
        result.update(saving_per_usable_tonne=None, saving_per_month=None, verdict="insufficient_data")
    else:
        saving = ci.baseline_price - per_usable
        result.update(saving_per_usable_tonne=round(saving, 2), saving_per_month=round(saving * usable_tonnes),
                      verdict="cheaper" if saving > 0 else "premium")
    return result


def sensitivity(ci: CostInputs) -> list[dict]:
    """How the landed cost moves when the most uncertain inputs change (one at a time)."""
    base = landed_cost(ci)
    cases = [("Freight +25%", {"transport_rate": ci.transport_rate * 1.25}), ("Freight −25%", {"transport_rate": ci.transport_rate * 0.75}),
             ("Processing +25%", {"processing": ci.processing * 1.25}), ("Rejection 10%", {"acceptance_yield": 0.90}),
             ("Material price +20%", {"material_price": (ci.material_price or 0) * 1.2}), ("Conventional price −10%", {"baseline_price": (ci.baseline_price or 0) * 0.9})]
    out = []
    for label, change in cases:
        r = landed_cost(CostInputs(**{**asdict(ci), **change}))
        out.append({"case": label, "cost_per_usable_tonne": r["cost_per_usable_tonne"], "saving_per_usable_tonne": r["saving_per_usable_tonne"],
                    "delta": round((r["cost_per_usable_tonne"] or 0) - (base["cost_per_usable_tonne"] or 0), 2), "verdict": r["verdict"]})
    return out


def break_even_distance(ci: CostInputs) -> float | None:
    """Distance (km) at which the substitute stops being cheaper than the conventional material."""
    if not ci.baseline_price or not ci.material_price:
        return None
    lo, hi = 0.0, 2000.0
    if landed_cost(CostInputs(**{**asdict(ci), "distance_km": hi}))["verdict"] == "cheaper":
        return None  # cheaper even at 2000 km
    if landed_cost(CostInputs(**{**asdict(ci), "distance_km": lo}))["verdict"] != "cheaper":
        return 0.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if landed_cost(CostInputs(**{**asdict(ci), "distance_km": mid}))["verdict"] == "cheaper":
            lo = mid
        else:
            hi = mid
    return round(lo, 1)
