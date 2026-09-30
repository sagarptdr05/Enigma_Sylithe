"""Exchange lifecycle: configurable stages, stage owners and allowed actions (pure rules, no DB)."""

ALL_STAGES = ["interest", "evidence", "assessment", "sample", "trial", "negotiation", "agreement",
              "dispatch", "receipt", "acceptance", "completed"]
OPTIONAL = {"evidence", "assessment", "sample", "trial"}
DEFAULT_STAGES = ["interest", "evidence", "assessment", "negotiation", "agreement", "dispatch", "receipt", "acceptance", "completed"]
ACTIVE_STAGES = {"dispatch", "receipt", "acceptance"}
COMMITTED_STAGES = {"agreement", "dispatch", "receipt", "acceptance", "completed"}

STAGE_INFO = {
    "interest": ("recipient", "Accept or decline the expression of interest"),
    "evidence": ("supplier", "Upload evidence for the material (lab report, SDS, certificate) and submit it"),
    "assessment": ("buyer", "Review property fit and evidence, then record the technical assessment"),
    "sample": ("buyer", "Receive a sample from the supplier and record the lab result"),
    "trial": ("buyer", "Run a plant trial and record the outcome"),
    "negotiation": ("either", "Propose price and monthly quantity, or accept the other party's offer"),
    "agreement": ("both", "Both parties sign the agreed terms"),
    "dispatch": ("supplier", "Record the dispatched quantity (manifest reference for hazardous material)"),
    "receipt": ("buyer", "Record the quantity received at the gate"),
    "acceptance": ("buyer", "Accept or reject the delivered material quality"),
    "completed": (None, "Exchange completed. Impact recorded."),
}

ACTIONS = {
    "interest": {"accept", "decline"},
    "evidence": {"submit_evidence"},
    "assessment": {"record_assessment"},
    "sample": {"record_sample"},
    "trial": {"record_trial"},
    "negotiation": {"offer", "accept_offer"},
    "agreement": {"sign"},
    "dispatch": {"dispatch"},
    "receipt": {"receive"},
    "acceptance": {"accept_delivery", "reject_delivery"},
    "completed": set(),
}
ANY_TIME = {"consent", "withdraw", "comment"}


def build_stages(include: list[str] | None) -> list[str]:
    """Mandatory stages + the optional ones the parties chose, in canonical order."""
    chosen = set(include) if include is not None else set(DEFAULT_STAGES)
    return [s for s in ALL_STAGES if s not in OPTIONAL or s in chosen]


def next_stage(stages: list[str], current: str) -> str:
    i = stages.index(current)
    return stages[min(i + 1, len(stages) - 1)]


def role_of(industry_id: int, supplier_id: int, buyer_id: int) -> str | None:
    return "supplier" if industry_id == supplier_id else "buyer" if industry_id == buyer_id else None


def may_act(stage: str, role: str, is_recipient: bool) -> bool:
    owner = STAGE_INFO[stage][0]
    if owner == "recipient":
        return is_recipient
    return owner in ("either", "both") or owner == role
