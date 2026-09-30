"""Material qualification: eligibility (separate from ranking), factor contributions, evidence states
and a trial / production-compatibility checklist generated from the actual gaps."""
from datetime import date, datetime, timedelta, timezone

from . import scoring

REVALIDATE_DAYS = 365
LAB = {"lab_report", "third_party_assessment", "historical_test"}


def evidence_state(e, today: date | None = None) -> dict:
    """not provided / under review / accepted (for stated purpose) / rejected / expired / revalidation required."""
    today = today or datetime.now(timezone.utc).date()
    expiry, issued = getattr(e, "expiry_date", None), getattr(e, "issue_date", None)
    if e.status == "rejected":
        return {"state": "rejected", "label": "Rejected"}
    if expiry and date.fromisoformat(expiry) < today:
        return {"state": "expired", "label": f"Expired {expiry}"}
    if e.type in LAB and issued and (today - date.fromisoformat(issued)).days > REVALIDATE_DAYS:
        return {"state": "revalidation_required", "label": f"Test from {issued}: revalidation required"}
    if e.status == "verified":
        return {"state": "accepted", "label": "Reviewed & accepted for stated purpose"}
    return {"state": "under_review", "label": "Uploaded, under review"}


def usable(e) -> bool:
    return evidence_state(e)["state"] in ("accepted", "under_review")


def eligibility(a: dict) -> dict:
    """A high score must not override a critical specification failure."""
    blocking = []
    for r in a["properties"]:
        if r["status"] == "FAIL":
            blocking.append(f"{r['label']} {r['actual']} is outside the required {r['min']}-{r['max']} (critical)")
    for g in a["gates"]:
        if g["status"] == "fail":
            blocking.append(g["text"])
    unknown = [r["label"] for r in a["properties"] if r["status"] == "UNKNOWN"]
    if blocking:
        return {"status": "not_eligible", "label": "Not eligible", "reasons": blocking}
    if unknown or any(g["status"] == "warn" for g in a["gates"]):
        return {"status": "conditional", "label": "Eligible, conditions open",
                "reasons": ([f"{', '.join(unknown)} unknown: test required"] if unknown else []) +
                           [g["text"] for g in a["gates"] if g["status"] == "warn" and g["key"] != "technical"]}
    return {"status": "eligible", "label": "Eligible", "reasons": []}


def factor_breakdown(m) -> dict:
    """Exact ranking formula with each factor's value, weight and contribution."""
    rows = [("Material compatibility", m.technical_fit, scoring.W_TECH, "Mean property fit vs buyer spec: 1 inside range, exp(-3 x deviation) outside, 0.5 if unknown"),
            ("Economic feasibility", m.economic_score, scoring.W_ECON, "Saving per tonne / virgin price, clamped 0-1"),
            ("Environmental benefit", m.co2_score, scoring.W_CO2, "CO2 avoided per tonne / best in network"),
            ("Distance & logistics", m.distance_score, scoring.W_DIST, "1 - road km / max distance"),
            ("Timing fit", m.timing_score, scoring.W_TIME, "Share of monthly demand covered by seasonal supply")]
    out = [{"factor": f, "value": round(v * 100, 1), "weight": round(w * 100), "contribution": round(v * w * 100, 1), "method": how} for f, v, w, how in rows]
    raw = sum(r["contribution"] for r in out)
    hazard = m.waste_stream.hazardous
    return {"factors": out, "raw_score": round(raw, 1), "hazard_penalty": scoring.HAZARD_PENALTY if hazard else None,
            "score": round(m.score, 1), "note": "Ranking score orders options. Eligibility is decided separately by the specification and gate checks."}


def generate_checklist(*, assessment: dict, processing_steps: list, category: str, hazardous: bool, monthly_tonnes: float,
                       include_sample: bool, include_trial: bool, start: date | None = None) -> list[dict]:
    start = start or datetime.now(timezone.utc).date()
    d = lambda n: (start + timedelta(days=n)).isoformat()
    items = [("review", "Technical review: compare supplier properties with our specification", "buyer", d(3),
              "Every required property is PASS or FIXABLE; no critical FAIL")]
    for ev in assessment["evidence"]["items"]:
        if ev["status"] == "missing":
            items.append(("document", f"Provide: {ev['label']}", "supplier", d(7), ev["action"] or "Document uploaded to the material passport"))
    if include_sample:
        qty = "25 kg" if category != "energy" else "7-day metered log"
        items.append(("sample", f"Send a representative sample ({qty}) with batch ID", "supplier", d(10), "Sample traceable to a production batch"))
    for r in assessment["properties"]:
        if r["status"] in ("UNKNOWN", "FAIL"):
            items.append(("lab_test", f"Lab test: {r['label']}", "buyer", d(14), f"{r['label']} within {r['min']}-{r['max']} on the sample"))
    for s in processing_steps:
        items.append(("production", f"Confirm processing: {s['step']} (who operates it, ₹{s['cost_per_tonne']:,.0f}/t)", "supplier", d(14),
                      "Processing responsibility and cost written into the terms"))
    storage = {"mineral": "Covered storage / silo, dust control, feeder calibration", "organic": "Moisture and odour control, first-in-first-out storage",
               "chemical": "Corrosion-proof storage, PPE and spill SOP", "energy": "Heat-exchanger tie-in and metering", "metal": "Sorting bay and charge-mix planning",
               "water": "Tankage and dosing system"}.get(category, "Storage and feeding review")
    items.append(("production", f"Production compatibility: {storage}", "buyer", d(18), "Production head confirms no equipment change or lists required changes"))
    if hazardous:
        items.append(("document", "Hazardous handling SOP and manifest (Form 10) arrangement", "both", d(18), "SOP signed by both EHS teams"))
    if include_trial:
        trial = max(5, round(monthly_tonnes * 0.1))
        items.append(("trial", f"Controlled plant trial: {trial:,} t at partial substitution", "buyer", d(30), "Product quality within standard; no process upset during the trial"))
    items.append(("decision", "Buyer technical approval by an authorised reviewer", "buyer", d(35),
                  "Signed off by the buyer's QA / production head. Sylithex never approves industrial use automatically."))
    return [{"position": i, "kind": k, "title": t, "owner": o, "due_date": dd, "acceptance_criteria": c} for i, (k, t, o, dd, c) in enumerate(items)]
