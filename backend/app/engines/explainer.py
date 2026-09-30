"""Plain-English match explanations: LLM (cached in DB) with a deterministic template fallback."""
from . import llm


def inr(x: float) -> str:
    """Format INR in Indian units: 3.8 L, 2.1 Cr."""
    a = abs(x)
    if a >= 1e7:
        s = f"{x / 1e7:.1f} Cr"
    elif a >= 1e5:
        s = f"{x / 1e5:.1f} L"
    else:
        s = f"{x:,.0f}"
    return f"₹{s}"


def main_risk(d: dict) -> str:
    if d["regulatory_flags"]:
        return f"hazardous-waste permissions ({d['regulatory_flags'][0]})"
    if d["timing_score"] < 0.8:
        return f"seasonal supply mismatch (only {d['timing_score'] * 100:.0f}% of monthly demand covered on average) - plan storage or a backup source"
    if d["processing_steps"]:
        steps = ", ".join(s["step"].lower() for s in d["processing_steps"])
        return f"processing before use ({steps})"
    return "a long-term offtake contract to lock in supply"


def template(d: dict) -> str:
    return (f"{d['source']['name']} generates ~{d['supply_tonnes']:,.0f} t/month of {d['waste_name']}, "
            f"which fits {d['buyer']['name']}'s {d['material']} spec ({d['technical_fit'] * 100:.0f}% technical fit). "
            f"At {d['distance_km']:.0f} km, it saves {inr(d['net_saving_per_year'])}/yr and "
            f"{d['co2_saved_per_year']:,.0f} tCO2/yr. Key prerequisite: {main_risk(d)}.")


def llm_payload(d: dict) -> dict:
    keys = ["waste_name", "material", "supply_tonnes", "demand_tonnes", "tradable_tonnes", "technical_fit",
            "distance_km", "saving_per_tonne", "net_saving_per_year", "co2_saved_per_year", "timing_score",
            "processing_steps", "regulatory_flags", "properties"]
    return {"source_industry": d["source"]["name"], "buyer": d["buyer"]["name"], **{k: d.get(k) for k in keys}}


def explain(d: dict) -> tuple[str, str]:
    """Returns (text, source) where source is 'llm' or 'template'."""
    text = llm.explain(llm_payload(d)) if llm.available() else None
    return (text, "llm") if text else (template(d), "template")
