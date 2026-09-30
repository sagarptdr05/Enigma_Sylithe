"""Hidden waste inference: knowledge base (type + capacity) and process text (LLM, keyword fallback)."""
import re

from . import kb, llm
from .similarity import canonical_name, similarity

FLAT = [1.0] * 12

# Offline fallback when no LLM key: process keywords -> by-products they imply
KEYWORD_RULES = [
    (("blast furnace",), "BF slag", "Blast furnace smelting separates a lime-silica slag from hot metal."),
    (("oxygen furnace", "arc furnace", "converter", "induction"), "Steel slag", "Steel refining in the furnace generates steel slag."),
    (("rolling", "reheat", "rolled"), "Mill scale", "Hot rolling/reheating oxidises the steel surface into mill scale."),
    (("kiln", "furnace", "boiler", "thermic", "reheat"), "Waste heat", "High-temperature equipment rejects recoverable heat."),
    (("cooling tower", "chilled", "cooling"), "Waste heat", "Cooling systems reject low-grade heat to atmosphere."),
    (("coal",), "Fly ash", "Coal combustion produces fly ash captured in ESPs."),
    (("ferment", "bio-cng", "upgraded", "calciner", "clinker"), "CO2 off-gas", "The process vents a concentrated CO2 stream."),
    (("lime kiln", "causticis", "lime mud"), "Lime sludge", "Causticising in chemical recovery generates lime sludge."),
    (("stillage", "distillation", "spent wash"), "Spent wash", "Distillation leaves potassium-rich spent wash."),
    (("pickling", "sulphonation", "sulphuric acid", "nitration"), "Spent acid", "Acid reactions/pickling leave a spent acid stream."),
    (("neutralised with lime", "neutralisation", "neutralised"), "Chemical gypsum", "Lime neutralisation of acid effluent precipitates gypsum sludge."),
    (("phosphoric acid", "rock phosphate"), "Phosphogypsum", "Phosphoric acid filtration separates phosphogypsum cake."),
    (("machining", "turnings", "bar ends"), "Metal scrap", "Machining generates ferrous turnings and offcuts."),
    (("foundry", "castings"), "Foundry sand", "Sand moulds are discarded after casting."),
    (("peel", "pomace", "reject", "sorting"), "Food waste", "Sorting and pulping reject organic residues."),
    (("clarified", "clarifier", "vacuum filter"), "Press mud", "Juice clarification filters produce press mud."),
    (("molasses is sold", "final molasses"), "Molasses", "Crystallisation leaves final molasses."),
    (("digester", "digestate"), "Digestate", "Anaerobic digestion leaves nutrient-rich digestate."),
    (("effluent treatment", "fibre sludge"), "Fibre sludge", "Effluent treatment settles fibre sludge."),
]
DEFAULT_FRACTION = {"mineral": 0.03, "organic": 0.03, "chemical": 0.01, "metal": 0.02, "energy": 0.1, "water": 0.05}


def _kb_stream(industry: dict, row: dict, source: str, confidence: float, reasoning: str) -> dict:
    unit = "MWh" if row["category"] == "energy" else "t"
    return dict(
        verification_status="user_declared" if source == "declared" else "ai_inferred",
        property_sources={k: "ai_inferred" for k in row["composition"]},
        assumptions=[f"Quantity = capacity x typical generation factor ({row['generation_factor']:g} {unit} per {industry.get('capacity_unit', 'unit')})"
                     + (" - quantity declared by the company" if source == "declared" else ""),
                     "Composition = typical values for this industry type (not measured)",
                     "Seasonality follows the industry's typical operating calendar"],
        waste_name=row["waste_name"], category=row["category"],
        monthly_tonnes=round(industry["capacity"] * row["generation_factor"], 1),
        composition=row["composition"], hazardous=row["hazardous"], seasonality=row["seasonality"],
        source=source, confidence=confidence, reasoning=reasoning,
        disposal_cost_per_tonne=row["disposal_cost_per_tonne"],
    )


def infer_from_kb(industry: dict, declared: list[str] | None = None) -> list[dict]:
    """All KB by-products for the industry type; declared ones are tagged as such."""
    declared = declared or []
    out = []
    for row in kb.waste_kb(industry["type"]):
        unit = "MWh" if row["category"] == "energy" else "t"
        if row["waste_name"] in declared:
            out.append(_kb_stream(industry, row, "declared", 1.0, "Declared by the industry in its waste returns."))
        else:
            out.append(_kb_stream(
                industry, row, "kb_inferred", 0.9,
                f"Standard by-product of {industry['type'].replace('_', ' ')} units: ~{row['generation_factor']} {unit} "
                f"per {industry.get('capacity_unit', 'unit')} of capacity (industry knowledge base)."))
    return out


def _keyword_items(industry: dict, text: str) -> list[dict]:
    low = text.lower()
    items = []
    for keys, name, why in KEYWORD_RULES:
        hit = next((k for k in keys if k in low), None)
        if not hit:
            continue
        tpl = kb.waste_template(name) or {}
        cat = tpl.get("category", "mineral")
        items.append(dict(
            waste_name=name, category=cat,
            monthly_tonnes=round(industry["capacity"] * DEFAULT_FRACTION.get(cat, 0.02), 1),
            composition=tpl.get("composition", {}), hazardous=tpl.get("hazardous", False),
            seasonality=tpl.get("seasonality", FLAT), source="kb_inferred", confidence=0.6,
            verification_status="ai_inferred", property_sources={k: "ai_inferred" for k in tpl.get("composition", {})},
            assumptions=[f"Detected from the keyword '{hit}' in the process description", "Quantity is a rough default share of capacity",
                         "Composition = typical values (not measured)"],
            reasoning=f"{why} (detected from process text: '{hit}'; offline rule engine)",
            disposal_cost_per_tonne=tpl.get("disposal_cost_per_tonne", 0),
        ))
    return items


TAG = re.compile(r"<[^>]*>")


def _clean(text, limit: int) -> str:
    return TAG.sub("", str(text or "")).strip()[:limit]


def _llm_items(industry: dict, text: str) -> list[dict]:
    raw = llm.extract_byproducts(industry["type"], industry["capacity"], industry.get("capacity_unit", ""), text)
    vocab = kb.waste_vocabulary()
    items = []
    for r in raw:
        name = canonical_name(_clean(r["waste_name"], 80), vocab)
        if not name:
            continue
        tpl = kb.waste_template(name) or {}
        comp = r.get("likely_composition") if isinstance(r.get("likely_composition"), dict) else {}
        comp = {k: v for k, v in comp.items() if isinstance(v, (int, float))} or tpl.get("composition", {})
        try:
            tonnes = float(r.get("estimated_monthly_tonnes") or 0)
        except (TypeError, ValueError):
            tonnes = 0.0
        tonnes = max(0.0, min(tonnes, industry["capacity"] * 50))  # reject absurd / negative LLM estimates
        cat = r.get("category") if r.get("category") in DEFAULT_FRACTION else tpl.get("category", "mineral")
        items.append(dict(
            waste_name=name, category=cat,
            monthly_tonnes=round(tonnes or industry["capacity"] * DEFAULT_FRACTION[cat], 1),
            composition=comp, hazardous=bool(r.get("hazardous", tpl.get("hazardous", False))),
            seasonality=tpl.get("seasonality", FLAT), source="llm_inferred",
            verification_status="ai_inferred", property_sources={k: "ai_inferred" for k in comp},
            assumptions=["Quantity and composition estimated by an LLM from the process description (not measured)"],
            confidence=_conf(r.get("confidence")),
            reasoning=_clean(r.get("reasoning"), 300) or "Inferred by LLM from process description.",
            disposal_cost_per_tonne=tpl.get("disposal_cost_per_tonne", 0),
        ))
    return items


def _conf(v) -> float:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.7


def merge(existing: list[dict], new: list[dict], threshold: float = 0.8) -> list[dict]:
    out = list(existing)
    for item in new:
        if any(similarity(item["waste_name"], e["waste_name"]) > threshold for e in out):
            continue
        out.append(item)
    return out


def infer_from_text(industry: dict, existing: list[dict] | None = None) -> list[dict]:
    """Return only NEW items (not already in `existing`) found in the process description."""
    text = industry.get("process_description") or ""
    existing = existing or []
    if not text.strip():
        return []
    new = _llm_items(industry, text) if llm.available() else []
    if not new:
        new = _keyword_items(industry, text)
    merged = merge(existing, new)
    return merged[len(existing):]


def infer_all(industry: dict, declared: list[str] | None = None) -> list[dict]:
    base = infer_from_kb(industry, declared)
    return base + infer_from_text(industry, base)


def build_demands(industry: dict) -> list[dict]:
    return [dict(
        material=row["raw_material"], monthly_tonnes=round(industry["capacity"] * row["consumption_factor"], 1),
        spec=row["required_spec"], virgin_price=row["virgin_price_per_tonne"],
        virgin_co2=row["virgin_co2_per_tonne"], seasonality=row["seasonality"],
        accepted_substitutes=row["accepted_substitutes"],
    ) for row in kb.demand_kb(industry["type"])]
