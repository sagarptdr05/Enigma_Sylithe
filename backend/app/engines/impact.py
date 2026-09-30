"""Exchange impact accounting with a sourced factor registry (DB table `emission_factors`, editable by a
facilitator). Transport = diesel combustion factor x truck fuel intensity; processing = step energy x grid factor.
Results are estimates unless the factors are reviewed and the quantities are independently verified."""
DEFAULT_FACTORS = [
    # key, label, value, unit, source, reference year
    ("diesel_combustion", "Diesel combustion", 0.00268, "tCO2 per litre",
     "IPCC 2006 Guidelines default for diesel oil (about 2.68 kg CO2 per litre)", "2006"),
    ("truck_fuel_intensity", "Heavy truck fuel intensity", 0.025, "litres per tonne-km",
     "Planning assumption for loaded heavy trucks on Indian roads; replace with fleet fuel records", "2026"),
    ("grid_electricity", "Indian grid electricity", 0.716, "tCO2 per MWh",
     "Weighted-average grid emission rate, CEA CO2 Baseline Database for the Indian power sector (confirm the latest version)", "FY2022-23"),
    ("energy_drying", "Drying energy", 90, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_grinding", "Grinding energy", 30, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_washing", "Washing / neutralisation energy", 12, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_pelletising", "Pelletising energy", 60, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_separation", "Crushing / screening / separation energy", 6, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_regeneration", "Acid regeneration energy", 150, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_capture", "CO2 capture & compression energy", 250, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_composting", "Composting energy", 8, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
    ("energy_other", "Other processing energy", 10, "kWh per tonne", "Indicative specific energy use; replace with plant meter data", "2026"),
]
STEP_KEYS = [("dry", "energy_drying"), ("grind", "energy_grinding"), ("wash", "energy_washing"), ("neutralis", "energy_washing"),
             ("pelletis", "energy_pelletising"), ("crush", "energy_separation"), ("screen", "energy_separation"), ("separation", "energy_separation"),
             ("magnetic", "energy_separation"), ("regeneration", "energy_regeneration"), ("re-concentration", "energy_regeneration"),
             ("capture", "energy_capture"), ("scrubbing", "energy_capture"), ("composting", "energy_composting")]
BOUNDARY = ("Gate-to-gate: virgin material production avoided at the buyer, minus road transport between the two sites and "
            "processing energy for the listed steps. Excludes buyer-side process changes, rejected-load disposal and indirect effects.")


def defaults() -> dict[str, dict]:
    return {k: {"key": k, "label": l, "value": v, "unit": u, "source": s, "reference_year": y, "status": "default"} for k, l, v, u, s, y in DEFAULT_FACTORS}


def transport_factor(f: dict) -> float:
    """tCO2 per tonne-km."""
    return f["diesel_combustion"]["value"] * f["truck_fuel_intensity"]["value"]


def step_energy_key(step: str) -> str:
    name = step.lower()
    if "heat exchanger" in name or "hot-water" in name or "heat-pump" in name:
        return ""
    return next((k for frag, k in STEP_KEYS if frag in name), "energy_other")


def processing_factor(steps: list[dict], f: dict) -> float:
    """tCO2 per tonne processed."""
    grid = f["grid_electricity"]["value"] / 1000  # tCO2 per kWh
    return sum(f[k]["value"] * grid for k in (step_energy_key(s["step"]) for s in steps) if k)


def net_benefit(tonnes: float | None, virgin_co2: float, distance_km: float, steps: list[dict], factors: dict | None = None) -> dict:
    f = factors or defaults()
    if tonnes is None:
        return {"status": "insufficient_data", "label": "Insufficient data to calculate"}
    avoided = tonnes * virgin_co2
    transport = tonnes * distance_km * transport_factor(f)
    processing = tonnes * processing_factor(steps, f)
    used = {"diesel_combustion", "truck_fuel_intensity", "grid_electricity"} | {step_energy_key(s["step"]) for s in steps}
    return {"status": "ok", "tonnes": round(tonnes, 1), "baseline_avoided": round(avoided, 1), "transport_emissions": round(transport, 2),
            "processing_emissions": round(processing, 2), "net_tco2": round(avoided - transport - processing, 1),
            "factors_reviewed": all(f[k]["status"] == "reviewed" for k in used if k),
            "formula": "Net = baseline emissions avoided − transport (diesel × fuel intensity × t-km) − processing (step energy × grid factor)"}
