"""Feasibility scoring - pure functions so the simulator can recompute in memory."""
from dataclasses import dataclass

W_TECH, W_ECON, W_CO2, W_DIST, W_TIME = 0.30, 0.25, 0.20, 0.15, 0.10
HAZARD_PENALTY = 0.9
TRANSPORT_CO2_PER_KM = 0.0001  # tCO2 per tonne-km


@dataclass
class Params:
    diesel_multiplier: float = 1.0
    transport_rate: float = 4.5  # INR per tonne-km
    carbon_price: float = 0.0  # INR per tCO2
    max_distance: float = 300.0
    virgin_price_multiplier: float = 1.0
    processing_multiplier: float = 1.0  # Time Machine: processing cost change
    supply_multiplier: float = 1.0  # Time Machine: supplier output change
    demand_multiplier: float = 1.0  # Time Machine: buyer demand change
    min_technical_fit: float = 0.4  # Time Machine: stricter / looser quality threshold


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def economics(c: dict, p: Params) -> dict:
    transport = c["distance_km"] * p.transport_rate * p.diesel_multiplier
    virgin = c["virgin_price"] * p.virgin_price_multiplier
    saving = virgin - transport - c["processing_cost"] * p.processing_multiplier + c["disposal"]
    co2_per_t = c["virgin_co2"] - c["distance_km"] * TRANSPORT_CO2_PER_KM
    return dict(transport_cost=transport, virgin=virgin, saving_per_tonne=saving, co2_per_t=co2_per_t,
                economic=clamp(saving / virgin) if virgin > 0 else 0.0)


def score_one(c: dict, p: Params, co2_max: float) -> dict | None:
    """Return the scored match or None when it is not viable under these params."""
    if c["distance_km"] > p.max_distance or c["technical_fit"] < p.min_technical_fit:
        return None
    e = economics(c, p)
    unit_value = e["saving_per_tonne"] + p.carbon_price * e["co2_per_t"]
    if unit_value <= 0:
        return None
    co2_score = clamp(e["co2_per_t"] / co2_max) if co2_max > 0 else 0.0
    dist_score = clamp(1 - c["distance_km"] / p.max_distance)
    score = 100 * (W_TECH * c["technical_fit"] + W_ECON * e["economic"] + W_CO2 * co2_score
                   + W_DIST * dist_score + W_TIME * c["timing"])
    if c["hazardous"]:
        score *= HAZARD_PENALTY
    tradable = min(c["supply"] * p.supply_multiplier, c["demand"] * p.demand_multiplier)
    yearly = tradable * 12
    return {
        **c, "score": round(score, 2), "economic_score": round(e["economic"], 4), "co2_score": round(co2_score, 4),
        "distance_score": round(dist_score, 4), "timing_score": round(c["timing"], 4),
        "technical_fit": round(c["technical_fit"], 4), "distance_km": round(c["distance_km"], 2),
        "tradable_tonnes": round(tradable, 1), "saving_per_tonne": round(e["saving_per_tonne"], 2),
        "transport_cost_per_tonne": round(e["transport_cost"], 2), "virgin_cost_per_tonne": round(e["virgin"], 2),
        "co2_per_tonne": round(e["co2_per_t"], 4),
        "net_saving_per_year": round(e["saving_per_tonne"] * yearly + p.carbon_price * e["co2_per_t"] * yearly, 0),
        "co2_saved_per_year": round(e["co2_per_t"] * yearly, 1),
    }


def co2_normaliser(cands: list[dict]) -> float:
    return max((c["virgin_co2"] - c["distance_km"] * TRANSPORT_CO2_PER_KM for c in cands), default=1.0)


def score_all(cands: list[dict], p: Params, co2_max: float | None = None) -> list[dict]:
    co2_max = co2_max if co2_max is not None else co2_normaliser(cands)
    out = [s for c in cands if (s := score_one(c, p, co2_max)) is not None]
    out.sort(key=lambda m: m["score"], reverse=True)
    return out
