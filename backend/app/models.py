from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Industry(Base):
    __tablename__ = "industries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(50), index=True)
    cluster: Mapped[str] = mapped_column(String(100), index=True)
    address: Mapped[str | None] = mapped_column(String(200), nullable=True)
    visibility: Mapped[str] = mapped_column(String(20), default="public")  # public | confidential
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    capacity: Mapped[float] = mapped_column(Float)
    capacity_unit: Mapped[str] = mapped_column(String(50))
    process_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    waste_streams: Mapped[list["WasteStream"]] = relationship(back_populates="industry", cascade="all, delete-orphan")
    demands: Mapped[list["Demand"]] = relationship(back_populates="industry", cascade="all, delete-orphan")


class WasteKB(Base):
    __tablename__ = "waste_kb"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    industry_type: Mapped[str] = mapped_column(String(50), index=True)
    waste_name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(20))
    generation_factor: Mapped[float] = mapped_column(Float)
    composition: Mapped[dict] = mapped_column(JSON)
    hazardous: Mapped[bool] = mapped_column(Boolean, default=False)
    seasonality: Mapped[list] = mapped_column(JSON)
    disposal_cost_per_tonne: Mapped[float] = mapped_column(Float, default=0)


class DemandKB(Base):
    __tablename__ = "demand_kb"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    industry_type: Mapped[str] = mapped_column(String(50), index=True)
    raw_material: Mapped[str] = mapped_column(String(100))
    consumption_factor: Mapped[float] = mapped_column(Float)
    required_spec: Mapped[dict] = mapped_column(JSON)
    virgin_price_per_tonne: Mapped[float] = mapped_column(Float)
    virgin_co2_per_tonne: Mapped[float] = mapped_column(Float)
    seasonality: Mapped[list] = mapped_column(JSON)
    accepted_substitutes: Mapped[list] = mapped_column(JSON)


class WasteStream(Base):
    __tablename__ = "waste_streams"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    waste_name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(20))
    monthly_tonnes: Mapped[float] = mapped_column(Float)
    composition: Mapped[dict] = mapped_column(JSON, default=dict)
    hazardous: Mapped[bool] = mapped_column(Boolean, default=False)
    seasonality: Mapped[list] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(20))  # declared | kb_inferred | llm_inferred
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    disposal_cost_per_tonne: Mapped[float] = mapped_column(Float, default=0)
    # trust model: ai_inferred | user_declared | verified | requires_evidence
    verification_status: Mapped[str] = mapped_column(String(30), default="ai_inferred")
    property_sources: Mapped[dict] = mapped_column(JSON, default=dict)  # {property: user_reported|ai_inferred|...}
    assumptions: Mapped[list] = mapped_column(JSON, default=list)
    physical_state: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # supply assurance: freshness + commercial constraints (None = never confirmed by the company)
    availability_updated_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    min_order_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_window: Mapped[str | None] = mapped_column(String(120), nullable=True)

    industry: Mapped[Industry] = relationship(back_populates="waste_streams")


class Demand(Base):
    __tablename__ = "demands"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    material: Mapped[str] = mapped_column(String(100))
    monthly_tonnes: Mapped[float] = mapped_column(Float)
    spec: Mapped[dict] = mapped_column(JSON, default=dict)
    virgin_price: Mapped[float] = mapped_column(Float)
    virgin_co2: Mapped[float] = mapped_column(Float)
    seasonality: Mapped[list] = mapped_column(JSON)
    accepted_substitutes: Mapped[list] = mapped_column(JSON, default=list)

    industry: Mapped[Industry] = relationship(back_populates="demands")


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    waste_stream_id: Mapped[int] = mapped_column(ForeignKey("waste_streams.id", ondelete="CASCADE"), index=True)
    demand_id: Mapped[int] = mapped_column(ForeignKey("demands.id", ondelete="CASCADE"), index=True)
    score: Mapped[float] = mapped_column(Float, index=True)
    technical_fit: Mapped[float] = mapped_column(Float)
    economic_score: Mapped[float] = mapped_column(Float)
    co2_score: Mapped[float] = mapped_column(Float)
    distance_score: Mapped[float] = mapped_column(Float)
    timing_score: Mapped[float] = mapped_column(Float)
    distance_km: Mapped[float] = mapped_column(Float)
    tradable_tonnes: Mapped[float] = mapped_column(Float)
    saving_per_tonne: Mapped[float] = mapped_column(Float)
    net_saving_per_year: Mapped[float] = mapped_column(Float)
    co2_saved_per_year: Mapped[float] = mapped_column(Float)
    processing_steps: Mapped[list] = mapped_column(JSON, default=list)
    regulatory_flags: Mapped[list] = mapped_column(JSON, default=list)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)

    waste_stream: Mapped[WasteStream] = relationship()
    demand: Mapped[Demand] = relationship()


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    contact_name: Mapped[str] = mapped_column(String(120))
    designation: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    industry_id: Mapped[int | None] = mapped_column(ForeignKey("industries.id"), index=True, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    role: Mapped[str] = mapped_column(String(20), default="company")  # company | facilitator
    email_alerts: Mapped[bool] = mapped_column(Boolean, default=True)

    industry: Mapped[Industry] = relationship()


class AuthSession(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[str] = mapped_column(String(40))

    user: Mapped[User] = relationship()


class Inquiry(Base):
    """A deal request between two companies about one match (offer to sell waste / request to buy it)."""
    __tablename__ = "inquiries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    from_industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    to_industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # offer (seller -> buyer) | request (buyer -> seller)
    monthly_tonnes: Mapped[float] = mapped_column(Float)
    price_per_tonne: Mapped[float | None] = mapped_column(Float, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | accepted | declined
    reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))
    # exchange lifecycle (an inquiry IS the exchange; it starts at the interest stage)
    stage: Mapped[str] = mapped_column(String(20), default="interest")
    stages: Mapped[list] = mapped_column(JSON, default=list)
    supplier_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    buyer_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    agreed_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    agreed_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    dispatched_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    received_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    signatures: Mapped[dict] = mapped_column(JSON, default=dict)  # {"supplier": ts, "buyer": ts}
    stage_data: Mapped[dict] = mapped_column(JSON, default=dict)  # per-stage results (assessment, sample, trial...)
    completed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    repeat_of: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # responsibility tracker + impact tracker
    responsibilities: Mapped[dict] = mapped_column(JSON, default=dict)  # {topic: supplier|buyer|shared}
    acceptance_criteria: Mapped[dict] = mapped_column(JSON, default=dict)  # {property: [min, max]}
    used_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    impact_verified_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    impact_verified_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    facilitation_requested: Mapped[bool] = mapped_column(Boolean, default=False)

    match: Mapped[Match] = relationship()
    events: Mapped[list["ExchangeEvent"]] = relationship(order_by="ExchangeEvent.id", cascade="all, delete-orphan")


class ExchangeEvent(Base):
    """Timeline / audit trail of an exchange: every state transition, offer, comment and evidence link."""
    __tablename__ = "exchange_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(30))  # transition | offer | comment | evidence | consent | blocker
    actor_industry_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String(40))


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    waste_stream_id: Mapped[int] = mapped_column(ForeignKey("waste_streams.id", ondelete="CASCADE"), index=True)
    uploaded_by_industry_id: Mapped[int] = mapped_column(Integer, index=True)
    # lab_report | spec_sheet | sds | certificate | historical_test | user_declaration | third_party_assessment
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str | None] = mapped_column(String(200), nullable=True)
    stored_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    linked_properties: Mapped[list] = mapped_column(JSON, default=list)
    reported_values: Mapped[dict] = mapped_column(JSON, default=dict)  # values stated in the document
    status: Mapped[str] = mapped_column(String(20), default="submitted")  # submitted | verified | rejected
    verified_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[str] = mapped_column(String(40))
    issuer: Mapped[str | None] = mapped_column(String(160), nullable=True)
    issue_date: Mapped[str | None] = mapped_column(String(20), nullable=True)  # YYYY-MM-DD
    expiry_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    batch_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    test_method: Mapped[str | None] = mapped_column(String(120), nullable=True)
    extraction_method: Mapped[str | None] = mapped_column(String(30), nullable=True)  # pdf_text | csv | text | llm | manual


class SourcingRequest(Base):
    __tablename__ = "sourcing_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id"), index=True)
    material: Mapped[str] = mapped_column(String(120))
    intended_use: Mapped[str] = mapped_column(String(200))
    monthly_tonnes: Mapped[float] = mapped_column(Float)
    radius_km: Mapped[float] = mapped_column(Float, default=150)
    spec: Mapped[dict] = mapped_column(JSON, default=dict)
    frequency: Mapped[str] = mapped_column(String(40), default="monthly")
    target_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    urgency: Mapped[str] = mapped_column(String(20), default="normal")
    evidence_requirements: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | fulfilled | closed
    created_at: Mapped[str] = mapped_column(String(40))


class SourcingLead(Base):
    """A potential supplier for a sourcing request. Inferred leads stay 'unconfirmed' until the company confirms."""
    __tablename__ = "sourcing_leads"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("sourcing_requests.id", ondelete="CASCADE"), index=True)
    waste_stream_id: Mapped[int] = mapped_column(ForeignKey("waste_streams.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="invited")  # invited | confirmed | declined
    confirmed_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40))
    updated_at: Mapped[str] = mapped_column(String(40))


class Batch(Base):
    """One delivery: dispatched, received, tested, accepted / rejected quantities kept separately."""
    __tablename__ = "batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    batch_code: Mapped[str] = mapped_column(String(60))
    dispatched_tonnes: Mapped[float] = mapped_column(Float)
    dispatched_at: Mapped[str] = mapped_column(String(40))
    manifest_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    promised_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    received_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    received_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    test_values: Mapped[dict] = mapped_column(JSON, default=dict)
    test_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    accepted_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    rejected_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="in_transit")  # in_transit | received | accepted | partial | rejected
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)


class SupplyRecord(Base):
    """Monthly availability / delivery history of a material. source: reported | demo."""
    __tablename__ = "supply_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    waste_stream_id: Mapped[int] = mapped_column(ForeignKey("waste_streams.id", ondelete="CASCADE"), index=True)
    month: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    available_tonnes: Mapped[float] = mapped_column(Float)
    committed_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivered_tonnes: Mapped[float | None] = mapped_column(Float, nullable=True)
    on_time: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="reported")
    recorded_at: Mapped[str] = mapped_column(String(40))


class ChecklistItem(Base):
    """Production compatibility & trial planner item, generated from spec gaps and processing needs."""
    __tablename__ = "checklist_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inquiry_id: Mapped[int] = mapped_column(ForeignKey("inquiries.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(30))  # review | document | sample | lab_test | production | trial | decision
    title: Mapped[str] = mapped_column(String(200))
    owner: Mapped[str] = mapped_column(String(20))  # supplier | buyer | both
    due_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | done | failed | waived
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_by: Mapped[str | None] = mapped_column(String(20), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Processor(Base):
    """Processing facility that can turn one material into a usable input (drying, grinding, regeneration...).
    source: synthetic (seed example) | registered (by its operator or a facilitator). status: unconfirmed | confirmed."""
    __tablename__ = "processors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    cluster: Mapped[str] = mapped_column(String(100))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    accepts: Mapped[list] = mapped_column(JSON, default=list)
    output_label: Mapped[str] = mapped_column(String(160))
    sets: Mapped[dict] = mapped_column(JSON, default=dict)  # properties of the output {prop: value}
    yield_share: Mapped[float] = mapped_column(Float)
    cost_per_tonne: Mapped[float] = mapped_column(Float)
    capacity_tpm: Mapped[float] = mapped_column(Float)
    steps: Mapped[list] = mapped_column(JSON, default=list)
    energy_kwh_per_tonne: Mapped[float | None] = mapped_column(Float, nullable=True)
    unresolved: Mapped[list] = mapped_column(JSON, default=list)
    operator_industry_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hazardous_permitted: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(20), default="registered")
    status: Mapped[str] = mapped_column(String(20), default="unconfirmed")
    updated_at: Mapped[str] = mapped_column(String(40))


class EmissionFactor(Base):
    """Every factor used in impact accounting, with its source. status: default (verify before reporting) | reviewed."""
    __tablename__ = "emission_factors"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(160))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(60))
    source: Mapped[str] = mapped_column(Text)
    reference_year: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="default")
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[str] = mapped_column(String(40))


class MaterialImage(Base):
    """Photo of a supplied by-product (role=supply) or of the material a buyer needs (role=requirement)."""
    __tablename__ = "material_images"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(20))  # supply | requirement
    waste_stream_id: Mapped[int | None] = mapped_column(ForeignKey("waste_streams.id", ondelete="CASCADE"), index=True, nullable=True)
    demand_id: Mapped[int | None] = mapped_column(ForeignKey("demands.id", ondelete="CASCADE"), index=True, nullable=True)
    owner_industry_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stored_name: Mapped[str] = mapped_column(String(100))
    content_type: Mapped[str] = mapped_column(String(40))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    caption: Mapped[str | None] = mapped_column(String(200), nullable=True)
    features: Mapped[list] = mapped_column(JSON, default=list)  # colour/texture descriptor (always)
    traits: Mapped[dict] = mapped_column(JSON, default=dict)  # human-readable: colour, texture, moisture look
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)  # CLIP embedding when the model is available
    predicted: Mapped[list] = mapped_column(JSON, default=list)  # [{material, score}] zero-shot, when available
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(40))


class Notification(Base):
    """One alert for one user: shown in the bell, optionally emailed."""
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # exchange | sourcing | evidence | facilitation | impact
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    read_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    emailed: Mapped[str | None] = mapped_column(String(20), nullable=True)  # sent | logged | off | failed
    created_at: Mapped[str] = mapped_column(String(40))
