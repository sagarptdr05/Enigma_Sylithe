"""Deterministic assessment: property status, evidence completeness, feasibility gates, blockers,
why / why-not reasons and two-sided economics. Shared by matches, discovery, sourcing and gaps.
No LLM here: every number comes from the database, user input or a formula."""
from . import scoring
from .matching import property_fit

LAB_TYPES = {"lab_report", "third_party_assessment", "historical_test"}
PROP_LABEL = {"CaO": "CaO", "SiO2": "SiO2", "Al2O3": "Al2O3", "Fe2O3": "Fe2O3", "moisture": "Moisture",
              "calorific_value_MJkg": "Calorific value", "organic_pct": "Organic matter", "acid_pct": "Acid strength",
              "K2O_pct": "K2O", "CO2_pct": "CO2 concentration", "temperature_C": "Temperature", "purity_pct": "Purity",
              "Fe_pct": "Fe content"}
UNIT = {"temperature_C": "°C", "calorific_value_MJkg": " MJ/kg"}
TESTING_COST_ONE_TIME = 15000  # typical NABL lab panel, INR (estimate)


def plabel(p: str) -> str:
    return PROP_LABEL.get(p, p)


def fmt(p: str, v) -> str:
    return "unknown" if v is None else f"{v:g}{UNIT.get(p, '%')}"


def effective_properties(ws, evidence: list) -> tuple[dict, dict]:
    """Composition + provenance per property. Evidence values override typical values.
    Provenance: lab_verified > document_reported > user_reported > ai_inferred."""
    comp = dict(ws.composition or {})
    src = {k: (ws.property_sources or {}).get(k, "ai_inferred") for k in comp}
    from .qualification import usable
    for e in sorted(evidence, key=lambda e: e.id):
        if not usable(e):
            continue
        for k, v in (e.reported_values or {}).items():
            if isinstance(v, (int, float)):
                comp[k] = v
                src[k] = "lab_verified" if (e.status == "verified" and e.type in LAB_TYPES) else "document_reported"
    return comp, src


def property_rows(comp: dict, src: dict, spec: dict) -> list[dict]:
    rows = []
    for p, (lo, hi) in (spec or {}).items():
        v = comp.get(p)
        if v is None:
            status, fit = "UNKNOWN", property_fit(None, lo, hi)
        else:
            fit = property_fit(v, lo, hi)
            status = "PASS" if fit >= 0.999 else "FAIL"
        rows.append({"property": p, "label": plabel(p), "actual": v, "min": lo, "max": hi, "status": status,
                     "fit": round(fit, 3), "source": src.get(p, "unknown") if v is not None else "unknown"})
    return rows


def evidence_requirements(ws, spec: dict, evidence: list, hazardous: bool) -> list[dict]:
    """What a buyer would need to see before committing. Each item: provided/verified/missing + owner."""
    from .qualification import usable
    live = [e for e in evidence if usable(e)]  # rejected, expired and stale tests do not count
    items = []

    def add(key, label, ok_evidence, action, verified=False):
        items.append({"key": key, "label": label, "status": ("verified" if verified else "provided") if ok_evidence else "missing",
                      "owner": "supplier", "action": None if ok_evidence else action})

    confirmed = ws.verification_status in ("user_declared", "verified")
    add("quantity", "Available quantity confirmed by the supplier", confirmed,
        "Supplier confirms monthly quantity on the material passport", ws.verification_status == "verified")
    add("location", "Site location (registered address)", True, None, True)
    props = [p for p in (spec or {}) if p != "temperature_C"]
    if ws.category == "energy" or "temperature_C" in (spec or {}):
        docs = [e for e in live if e.type in ("historical_test", "spec_sheet", "lab_report")]
        add("metering", "Metered heat / temperature log", bool(docs), "Upload a temperature / flow log",
            any(e.status == "verified" for e in docs))
    if props:
        covered = set()
        for e in live:
            if e.type in LAB_TYPES:
                covered |= set(e.linked_properties or []) | set((e.reported_values or {}).keys())
        missing = [p for p in props if p not in covered]
        lab_verified = all(any(e.status == "verified" and e.type in LAB_TYPES and (p in (e.linked_properties or []) or p in (e.reported_values or {}))
                               for e in live) for p in props)
        add("composition", f"Composition lab report ({', '.join(plabel(p) for p in props)})", not missing,
            f"Upload latest lab report covering {', '.join(plabel(p) for p in missing)}", lab_verified and not missing)
    if hazardous:
        sds = [e for e in live if e.type == "sds" or (e.type in LAB_TYPES and "contaminants" in (e.linked_properties or []))]
        add("contamination", "Contamination analysis / SDS", bool(sds), "Upload SDS or contamination analysis",
            any(e.status == "verified" for e in sds))
        cert = [e for e in live if e.type == "certificate"]
        add("authorisation", "Hazardous-waste authorisation (MPCB, Rule 9)", bool(cert),
            "Upload MPCB authorisation / Rule 9 permission", any(e.status == "verified" for e in cert))
    return items


def completeness(items: list[dict]) -> float:
    return round(sum(1 for i in items if i["status"] != "missing") / len(items), 3) if items else 1.0


def assess(*, ws, evidence: list, spec: dict, material: str, need_tonnes: float, virgin_price: float, virgin_co2: float,
           distance_km: float, processing_steps: list, regulatory_flags: list, timing_score: float | None = None,
           params: scoring.Params | None = None, agreed_price: float | None = None, price_source: str = "ESTIMATE") -> dict:
    p = params or scoring.Params()
    comp, src = effective_properties(ws, evidence)
    rows = property_rows(comp, src, spec)
    step_names = " ".join(s["step"].lower() for s in processing_steps)
    fixers = {"moisture": ("dry", "the drying step"), "acid_pct": ("concentration", "acid re-concentration"),
              "temperature_C": ("heat-pump", "the heat-pump temperature lift")}
    for r in rows:
        fx = fixers.get(r["property"])
        if r["status"] == "FAIL" and fx and fx[0] in step_names:
            r["status"], r["note"] = "FIXABLE", f"Brought within spec by {fx[1]}"
    tech = sum(r["fit"] for r in rows) / len(rows) if rows else 1.0
    fails = [r for r in rows if r["status"] == "FAIL"]
    unknowns = [r for r in rows if r["status"] == "UNKNOWN"]
    supply = ws.monthly_tonnes * p.supply_multiplier
    need_tonnes = need_tonnes * p.demand_multiplier
    coverage = supply / need_tonnes if need_tonnes else 1.0
    unit = "MWh" if ws.category == "energy" else "t"
    transport = distance_km * p.transport_rate * p.diesel_multiplier
    processing = sum(s["cost_per_tonne"] for s in processing_steps) * p.processing_multiplier
    virgin = virgin_price * p.virgin_price_multiplier
    disposal = ws.disposal_cost_per_tonne or 0
    saving = virgin - transport - processing + disposal
    co2_t = virgin_co2 - distance_km * scoring.TRANSPORT_CO2_PER_KM
    tradable = min(supply, need_tonnes) if need_tonnes else supply
    ev_items = evidence_requirements(ws, spec, evidence, ws.hazardous)
    ev_score = completeness(ev_items)
    max_km = min(p.max_distance, 20) if ws.category == "energy" else p.max_distance

    gates = []

    def gate(key, label, status, text):
        gates.append({"key": key, "label": label, "status": status, "text": text})

    if tech < 0.4:
        gate("technical", "Technical", "fail", f"Technical fit {tech:.0%} is below the 40% minimum")
    elif fails or unknowns:
        parts = []
        if fails:
            parts.append("Outside spec: " + ", ".join(f"{r['label']} {fmt(r['property'], r['actual'])} vs {r['min']:g}-{r['max']:g}" for r in fails))
        if unknowns:
            parts.append(", ".join(r["label"] for r in unknowns) + " not yet known: test required")
        gate("technical", "Technical", "warn", "; ".join(parts))
    else:
        gate("technical", "Technical", "ok", "All required properties within spec" if rows else "No property spec required")
    if coverage >= 1:
        gate("quantity", "Quantity", "ok", f"{supply:,.0f} {unit}/month covers the {need_tonnes:,.0f} {unit}/month need")
    elif coverage >= 0.1:
        gate("quantity", "Quantity", "warn", f"Covers {coverage:.0%} of the need ({supply:,.0f} of {need_tonnes:,.0f} {unit}/month)")
    else:
        gate("quantity", "Quantity", "fail", f"Only {supply:,.0f} {unit}/month available vs {need_tonnes:,.0f} needed")
    if distance_km > max_km:
        gate("distance", "Distance", "fail", f"{distance_km:.0f} km exceeds the {max_km:.0f} km limit" + (" for heat/gas networks" if ws.category == "energy" else ""))
    else:
        gate("distance", "Distance", "ok", f"{distance_km:.0f} km by road")
    share = processing / virgin if virgin else 0
    gate("processing", "Processing", "warn" if share > 0.3 else "ok",
         (", ".join(s["step"] for s in processing_steps) + f" ≈ ₹{processing:,.0f}/{unit} ({share:.0%} of virgin price)") if processing_steps else "Direct use, no processing")
    if saving + p.carbon_price * co2_t <= 0:
        gate("economics", "Economics", "fail", f"Transport + processing exceed the ₹{virgin:,.0f}/{unit} virgin price")
    else:
        gate("economics", "Economics", "ok", f"≈ ₹{saving:,.0f}/{unit} combined saving vs ₹{virgin:,.0f} virgin {material} (estimate)")
    gate("regulatory", "Regulatory", "warn" if ws.hazardous else "ok",
         "Hazardous: " + "; ".join(regulatory_flags[:2]) if ws.hazardous else "Non-hazardous: standard consent only")
    missing = [i for i in ev_items if i["status"] == "missing"]
    gate("evidence", "Evidence", "ok" if not missing else "warn",
         f"Evidence {ev_score:.0%} complete" + ("" if not missing else ": missing " + "; ".join(i["label"] for i in missing)))
    if timing_score is not None and timing_score < 0.7:
        gate("timing", "Timing", "warn", f"Seasonal supply covers {timing_score:.0%} of monthly demand on average")

    # blockers: fail first, then evidence/regulatory/technical warnings, each with owner + action
    blockers = []
    for g in gates:
        if g["status"] == "ok":
            continue
        owner, action = "buyer", None
        if g["key"] == "evidence":
            first = missing[0]
            owner, action = first["owner"], first["action"]
        elif g["key"] == "technical":
            owner, action = "supplier", ("Upload a lab report for " + ", ".join(r["label"].lower() for r in unknowns)) if unknowns else "Agree a processing step or a blended dosage with the buyer"
        elif g["key"] == "regulatory":
            owner, action = "supplier", "Obtain / upload MPCB authorisation and Rule 9 utilisation permission"
        elif g["key"] == "quantity":
            owner, action = "buyer", "Combine with a second supplier or reduce the substitution rate"
        elif g["key"] == "distance":
            owner, action = "buyer", "Look for a closer supplier or a shared logistics route"
        elif g["key"] == "economics":
            owner, action = "both", "Reduce processing cost or wait for a higher virgin price / carbon price"
        elif g["key"] == "processing":
            owner, action = "supplier", "Confirm who operates the processing step and at what cost"
        elif g["key"] == "timing":
            owner, action = "buyer", "Plan storage or a backup source for the off-season"
        blockers.append({"gate": g["key"], "severity": g["status"], "text": g["text"], "owner": owner, "action": action})
    blockers.sort(key=lambda b: (b["severity"] != "fail", ["evidence", "technical", "regulatory", "quantity", "economics", "distance", "processing", "timing"].index(b["gate"])))
    viable = not any(g["status"] == "fail" for g in gates)

    why = []
    for r in rows:
        if r["status"] == "FIXABLE":
            why.append(f"{r['label']} {fmt(r['property'], r['actual'])} is brought within {r['min']:g}-{r['max']:g} by processing")
        if r["status"] == "PASS":
            why.append(f"{r['label']} {fmt(r['property'], r['actual'])} is within the required {r['min']:g}-{r['max']:g}")
    if coverage >= 1:
        why.append(f"Available quantity ({supply:,.0f} {unit}/month) meets the buyer's need")
    if distance_km <= max_km:
        why.append(f"{distance_km:.0f} km transport distance")
    if processing_steps and share <= 0.3:
        why.append(f"Processing cost is acceptable ({share:.0%} of the virgin price)")
    if saving > 0:
        why.append(f"Virgin {material} price (₹{virgin:,.0f}/{unit}) leaves a potential saving of ₹{saving:,.0f}/{unit} (estimate)")
    concerns = [("✗ " if b["severity"] == "fail" else "⚠ ") + b["text"] for b in blockers]

    # two-sided economics: combined saving split by an indicative transfer price
    price = agreed_price if agreed_price is not None else round(max(virgin * 0.35, 0))
    plabel_src = "USER PROVIDED" if agreed_price is not None else "ESTIMATE"
    buyer = {"lines": [
        {"label": f"Virgin {material} avoided", "value": virgin, "basis": price_source},
        {"label": "Price paid to supplier", "value": -price, "basis": plabel_src},
        {"label": "Transport (buyer arranges)", "value": -transport, "basis": "ESTIMATE"},
    ], "testing_one_time": TESTING_COST_ONE_TIME}
    buyer["net_per_unit"] = sum(l["value"] for l in buyer["lines"])
    supplier = {"lines": [
        {"label": "Material revenue", "value": price, "basis": plabel_src},
        {"label": "Disposal cost avoided" if disposal >= 0 else "Current sale value forgone", "value": disposal, "basis": "ESTIMATE"},
        {"label": "Processing (supplier operates)", "value": -processing, "basis": "ESTIMATE"},
    ]}
    supplier["net_per_unit"] = sum(l["value"] for l in supplier["lines"])
    return {
        "properties": rows, "technical_fit": round(tech, 3), "gates": gates, "viable": viable,
        "evidence": {"completeness": ev_score, "items": ev_items},
        "readiness": {"ready": viable and not blockers, "main_blocker": blockers[0] if blockers else None, "blockers": blockers},
        "why_match": why, "concerns": concerns,
        "economics": {"unit": unit, "buyer": buyer, "supplier": supplier, "combined_per_unit": round(saving, 2),
                      "tradable_per_month": round(tradable, 1), "combined_per_year_estimate": round(saving * tradable * 12),
                      "co2_per_unit": round(co2_t, 4), "co2_per_year_estimate": round(co2_t * tradable * 12, 1),
                      "note": "Indicative split. Transfer price defaults to 35% of the virgin price until the parties agree a price."},
        "distance_km": round(distance_km, 1), "coverage": round(coverage, 3), "unit": unit,
    }
