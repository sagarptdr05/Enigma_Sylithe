export interface NodeRef { id: number; name: string; type: string; cluster: string; lat: number; lon: number; hidden?: boolean; confidential?: boolean }

export interface Industry extends NodeRef {
  address?: string | null; capacity: number; capacity_unit: string; process_description: string | null;
  match_count?: number; hidden_count?: number;
}

export interface Step { step: string; cost_per_tonne: number }

export interface Match {
  id: number; waste_stream_id: number; demand_id: number; src_id: number; dst_id: number;
  source: NodeRef; buyer: NodeRef; waste_name: string; waste_source: string; category: string; hazardous: boolean;
  material: string; supply: number; demand: number; score: number; trust?: Trust; technical_fit: number; economic_score: number;
  co2_score: number; distance_score: number; timing_score: number; distance_km: number; tradable_tonnes: number;
  saving_per_tonne: number; net_saving_per_year: number; co2_saved_per_year: number; co2_per_tonne: number;
  processing_steps: Step[]; regulatory_flags: string[];
}

export interface PropertyRow { property: string; actual: number | null; min: number; max: number; fit: number; ok: boolean }

export interface MatchDetail extends Omit<Match, "source" | "buyer"> {
  source: Industry; buyer: Industry; supply_tonnes: number; demand_tonnes: number; properties: PropertyRow[];
  seasonality: { months: string[]; supply: number[]; demand: number[] };
  economics: { virgin_price: number; transport_cost: number; processing_cost: number; disposal_avoided: number; saving_per_tonne: number };
  explanation: string; explanation_source: "llm" | "template"; waste_reasoning: string | null; waste_confidence: number;
}

export interface WasteStream {
  id: number; waste_name: string; category: string; monthly_tonnes: number; composition: Record<string, number>;
  hazardous: boolean; seasonality: number[]; source: "declared" | "kb_inferred" | "llm_inferred"; confidence: number;
  reasoning: string | null; top_matches: Match[]; match_count: number; trust: Trust; property_sources: Record<string, string>; assumptions: string[];
}

export interface DemandRow {
  id: number; material: string; monthly_tonnes: number; spec: Record<string, [number, number]>; virgin_price: number;
  virgin_co2: number; accepted_substitutes: string[]; top_suppliers: Match[]; supplier_count: number;
}

export interface IndustryDetail extends Industry {
  waste_streams: WasteStream[]; demands: DemandRow[];
  totals: { outgoing_saving: number; incoming_saving: number; hidden_streams: number }; track_record?: TrackRecord;
}

export interface Kpis {
  saving_per_year: number; co2_per_year: number; waste_diverted_per_year: number; matches: number; loops: number; industries: number;
}

export interface Cluster extends Kpis { name: string; context: "heavy" | "agro" | "urban" | "mixed"; center: { lat: number; lon: number } }

export interface Impact extends Kpis {
  tiers: { potential: ImpactTier; committed: ImpactTier; reported: ImpactTier; verified: ImpactTier };
  by_category: { category: string; tonnes_per_year: number }[];
  by_cluster: { cluster: string; saving_per_year: number; co2_per_year: number; waste_diverted_per_year: number }[];
  top: Match[];
}

export interface GraphLink {
  source: number | GNode; target: number | GNode; match_id: number | null; material: string; buyer_material: string;
  tonnes: number; saving: number; co2: number; score: number; status?: string;
}
export interface GNode { id: number; name: string; type: string; lat: number; lon: number; cluster: string; x?: number; y?: number }
export interface GraphData { nodes: GNode[]; links: GraphLink[] }

export interface LoopEdge { source: number; target: number; source_name: string; target_name: string; material: string; buyer_material: string; tonnes: number; saving: number; co2: number; score: number; match_id: number | null }
export interface Loop {
  members: { id: number; name: string; type: string }[]; edges: LoopEdge[]; length: number;
  total_saving: number; total_co2: number; materials: string[];
}
export interface LoopsResponse { loops: Loop[]; chains: Loop[]; totals: { loops: number; chains: number; loop_saving: number; loop_co2: number } }

export interface Params { diesel_multiplier: number; carbon_price: number; max_distance: number; virgin_price_multiplier: number;
  processing_multiplier: number; supply_multiplier: number; demand_multiplier: number; min_technical_fit: number }

export interface SimMatch { id: number | null; source: NodeRef; buyer: NodeRef; waste_name: string; material: string; score: number; tradable_tonnes: number; net_saving_per_year: number; distance_km: number }
export interface SimulateResponse {
  kpis: Kpis; baseline: Kpis; viable_count: number; baseline_count: number;
  dropped: (Match & { reason: string })[]; dropped_count: number; matches: SimMatch[];
}

export interface InferItem {
  waste_name: string; category: string; monthly_tonnes: number; hazardous: boolean; source: string; confidence: number; reasoning: string;
}

export interface SearchResult {
  waste_stream_id: number; industry: NodeRef; waste_name: string; category: string; monthly_tonnes: number; source: string;
  hazardous: boolean; distance_km: number; similarity: number; coverage: number; transport_cost_per_tonne: number; score: number;
}

export interface Meta { industry_types: { type: string; capacity_unit: string }[]; llm: boolean; waste_vocabulary: string[]; raw_materials: string[] }

export interface User {
  id: number; email: string; contact_name: string; designation: string | null; phone: string | null; is_demo: boolean;
  role: "company" | "facilitator"; industry: (Industry & { visibility: "public" | "confidential" }) | null;
}
export interface DemoAccount { user_id: number; contact_name: string; designation: string | null; role?: string; industry: { id: number | null; name: string; type: string; cluster: string } }

export interface InquiryRow {
  id: number; kind: "offer" | "request"; status: "pending" | "accepted" | "declined"; direction: "incoming" | "outgoing";
  monthly_tonnes: number; price_per_tonne: number | null; message: string | null; reply: string | null;
  created_at: string; updated_at: string; counterparty: NodeRef;
  counterparty_contact: { name: string; designation: string | null; email: string; phone: string | null } | null;
  match: { id: number; waste_name: string; material: string; score: number; distance_km: number; tradable_tonnes: number;
    net_saving_per_year: number; co2_saved_per_year: number; category: string; hazardous: boolean; regulatory_flags: string[] };
}
export interface Inbox { incoming: InquiryRow[]; outgoing: InquiryRow[]; pending_incoming: number }

// ---------------------------------------------------------------- upgrade: trust, assessment, exchanges
export type Trust = "ai_inferred" | "user_declared" | "verified" | "requires_evidence";
export type PropStatus = "PASS" | "FAIL" | "FIXABLE" | "UNKNOWN";
export interface AssessedProperty { property: string; label: string; actual: number | null; min: number; max: number; status: PropStatus; fit: number; source: string; note?: string }
export interface Gate { key: string; label: string; status: "ok" | "warn" | "fail"; text: string }
export interface Blocker { gate: string; severity: "warn" | "fail"; text: string; owner: string; action: string | null }
export interface EvidenceItem { key: string; label: string; status: "verified" | "provided" | "missing"; owner: string; action: string | null }
export interface EconLine { label: string; value: number; basis: string }
export interface Economics {
  unit: string; buyer: { lines: EconLine[]; net_per_unit: number; testing_one_time: number }; supplier: { lines: EconLine[]; net_per_unit: number };
  combined_per_unit: number; tradable_per_month: number; combined_per_year_estimate: number; co2_per_unit: number; co2_per_year_estimate: number; note: string;
}
export interface Assessment {
  properties: AssessedProperty[]; technical_fit: number; gates: Gate[]; viable: boolean;
  evidence: { completeness: number; items: EvidenceItem[] };
  readiness: { ready: boolean; main_blocker: Blocker | null; blockers: Blocker[] };
  why_match: string[]; concerns: string[]; economics: Economics;
}
export interface MatchAssessment extends Assessment, Qualification {
  scores: Record<string, number>; overall_score: number; trust: Trust; exchange: { id: number; stage: string; status: string } | null;
  viewer_role: "supplier" | "buyer" | null; waste_stream_id: number;
}
export interface AltStream {
  waste_stream_id: number; industry: NodeRef & { hidden?: boolean; address?: string | null }; monthly_tonnes: number; trust: Trust; source: string;
  confidence: number; hazardous: boolean; distance_km: number; coverage: number; technical_fit: number; gates: Gate[]; viable: boolean;
  readiness: Assessment["readiness"]; why_match: string[]; concerns: string[]; properties: AssessedProperty[]; evidence: Assessment["evidence"];
  unit: string; combined_per_year_estimate: number; combined_per_unit: number; co2_per_year_estimate: number; match_id?: number | null;
  landed_cost_per_usable_tonne: number | null; freshness: Freshness; min_order: number | null;
}
export interface Alternative {
  material: string; category: string | null; hazardous: boolean; routes: string[]; explanation: string; status: "feasible" | "not_feasible" | "no_supply";
  feasible_count: number; total_count: number; best_value_per_year: number; streams: AltStream[]; why_not: string[];
}
export interface DiscoverResult {
  applications: { industry_type: string; use: string; raw_material: string; match_score: number }[]; spec: Record<string, [number, number]>;
  spec_labels: Record<string, string>; virgin_price: number; price_source: string; raw_material: string; alternatives: Alternative[];
  location: { lat: number; lon: number; label: string }; pipeline: string[];
  supply_plan: Backups["allocation"]; routes: RouteRow[];
}
export interface EvidenceDoc {
  id: number; type: string; title: string; filename: string | null; has_file: boolean; file_accessible: boolean; size_bytes: number;
  linked_properties: string[]; reported_values: Record<string, number>; status: "submitted" | "verified" | "rejected"; verified_by: string | null;
  notes: string | null; uploaded_at: string; state: string; label: string; issuer: string | null; issue_date: string | null;
  expiry_date: string | null; batch_code: string | null; test_method: string | null; extraction_method?: string | null;
}
export interface Passport {
  id: number; material: string; category: string; physical_state: string | null; owner: boolean;
  company: NodeRef & { hidden?: boolean; address?: string | null; confidential?: boolean };
  quantity: { value: number; unit: string; source: string; confidence: number };
  availability: { seasonality: number[]; months: string[] };
  trust: { status: Trust; labels: string[]; source: string; confidence: number; reasoning: string | null; assumptions: string[] };
  properties: { property: string; label: string; value: number; source: string }[]; hazardous: boolean; regulatory: string[];
  applications: { industry_type: string; raw_material: string; required_spec: Record<string, [number, number]>; processing: Step[] }[];
  economics: { disposal_cost_per_unit: number; basis: string; best_match_value_per_year: number; match_count: number };
  environment: { best_co2_per_year: number }; top_matches: Match[]; evidence: EvidenceDoc[];
  supply: SupplyPanelData; track_record: TrackRecord;
}
export interface Pathway {
  application: string; kind: "network" | "market"; buyers_in_network: number; candidate_buyers: number; technical_fit: number | string;
  processing: Step[]; processing_cost: number; nearest_km: number | null; value_per_unit: number | null; value_per_year: number; co2_per_year: number;
  evidence: string[]; regulatory: string[]; basis: string;
}
export interface ExchangeEventRow { id: number; stage: string; kind: string; text: string | null; data: Record<string, unknown>; created_at: string; actor: string }
export interface Exchange {
  id: number; kind: "offer" | "request"; status: "pending" | "accepted" | "declined" | "closed" | "completed"; stage: string; stages: string[];
  direction: "incoming" | "outgoing"; role: "supplier" | "buyer" | null; monthly_tonnes: number; price_per_tonne: number | null;
  message: string | null; reply: string | null; created_at: string; updated_at: string;
  counterparty: NodeRef & { hidden?: boolean; address?: string | null };
  consent: { supplier: boolean; buyer: boolean; identity_revealed: boolean };
  counterparty_contact: { name: string; designation: string | null; email: string; phone: string | null } | null;
  next: { owner: string | null; action: string; waiting_on: string | null };
  terms: { price: number | null; tonnes: number | null; offer: { by: string; price: number; tonnes: number } | null; signatures: Record<string, string> };
  quantities: { dispatched: number | null; received: number | null }; repeat_of: number | null; completed_at: string | null;
  match: { id: number; waste_name: string; material: string; score: number; distance_km: number; tradable_tonnes: number; net_saving_per_year: number;
    co2_saved_per_year: number; category: string; hazardous: boolean; regulatory_flags: string[]; saving_per_tonne: number; co2_per_tonne: number;
    waste_stream_id: number; source: NodeRef & { hidden?: boolean }; buyer: NodeRef & { hidden?: boolean } };
  assessment?: Pick<Assessment, "gates" | "readiness" | "evidence" | "properties" | "economics" | "why_match" | "concerns">;
  stage_data?: Record<string, { result?: string; notes?: string }>; events?: ExchangeEventRow[]; evidence_count?: number;
  checklist?: ChecklistItemRow[]; batches?: BatchRow[]; responsibilities?: Record<string, string>; acceptance_criteria?: Record<string, [number, number]>;
  impact_record?: ImpactRecordData; facilitation_requested?: boolean;
  landed_cost?: Pick<LandedCost, "cost_per_usable_tonne" | "baseline_per_usable_tonne" | "saving_per_usable_tonne" | "verdict" | "usable_share">;
  impact?: { tonnes: number; saving: number; co2: number; basis: string; verified?: boolean };
}
export interface ExchangeList { incoming: Exchange[]; outgoing: Exchange[]; pending_incoming: number }
export interface SourcingRequestRow {
  id: number; industry_id: number; material: string; intended_use: string; monthly_tonnes: number; radius_km: number; spec: Record<string, [number, number]>;
  frequency: string; target_price: number | null; urgency: string; evidence_requirements: string[]; status: string; created_at: string;
}
export interface SourcingCandidate extends AltStream { material: string; label?: string; lead: { id: number; status: string; confirmed_tonnes: number | null } | null }
export interface SourcingLeadRow {
  id: number; status: string; confirmed_tonnes: number | null; note: string | null; created_at: string; material: string; waste_stream_id: number;
  estimated_tonnes: number; trust: Trust; request: SourcingRequestRow; buyer: NodeRef & { hidden?: boolean };
}
export interface Gaps {
  cluster: string; funnel: { stage: string; count: number }[]; bottleneck: { stage: string; lost: number; explanation: string };
  supply_gaps: { material: string; plants: number; monthly: number }[]; demand_gaps: { material: string; plants: number; monthly: number; inferred: number }[];
  evidence_gaps: { item: string; matches: number }[]; processing_gaps: { step: string; matches: number }[]; geography_gaps: { material: string; matches: number }[];
}
export interface ImpactTier { saving: number; co2: number; tonnes: number; exchanges: number; basis: string }

// ---------------------------------------------------------------- buyer-side execution
export interface CostLine { label: string; per_delivered_tonne: number; basis: string }
export interface LandedCost {
  inputs: Record<string, number | string | null>; lines: CostLine[]; cost_per_delivered_tonne: number; usable_share: number; usable_tonnes_per_month: number;
  cost_per_usable_tonne: number | null; baseline_per_usable_tonne: number | null; saving_per_usable_tonne: number | null; saving_per_month: number | null;
  verdict: "cheaper" | "premium" | "insufficient_data"; missing: string[]; exclusions: string[]; formula: string;
  sensitivity: { case: string; cost_per_usable_tonne: number | null; saving_per_usable_tonne: number | null; delta: number; verdict: string }[];
  break_even_km: number | null;
}
export interface Freshness { status: "fresh" | "stale" | "never_confirmed"; days: number | null; label: string }
export interface Reliability { level: "high" | "medium" | "low" | "not_established"; label: string; on_time_pct: number | null; fill_rate_pct: number | null; acceptance_pct?: number | null; months: number | null; variability: number | null; demo_data: boolean; basis?: "platform" | "reported" | "demo" | null }
export interface SupplyPanelData {
  available: number; unit: string; min_order: number | null; delivery_window: string | null; trust: Trust; freshness: Freshness; reliability: Reliability;
  need?: number; coverage_pct?: number | null; shortfall?: number | null;
  history: { month: string; available: number; committed: number | null; delivered: number | null; on_time: boolean | null; source: string }[];
}
export interface Eligibility { status: "eligible" | "conditional" | "not_eligible"; label: string; reasons: string[] }
export interface FactorRow { factor: string; value: number; weight: number; contribution: number; method: string }
export interface EvidenceDocState { id: number; type: string; title: string; issuer: string | null; issue_date: string | null; expiry_date: string | null; state: string; label: string }
export interface Qualification {
  eligibility: Eligibility; factors: { factors: FactorRow[]; raw_score: number; hazard_penalty: number | null; score: number; note: string };
  landed_cost: LandedCost; supply: SupplyPanelData; evidence_documents: EvidenceDocState[]; latest_test_date: string | null; demand_id: number;
}
export interface BackupOption {
  id: number; match_id: number | null; is_primary: boolean; supplier: NodeRef & { hidden?: boolean }; material: string; trust: Trust; capacity: number;
  distance_km: number; technical_fit: number; eligibility: string; evidence_completeness: number; timing: number; co2_per_tonne: number;
  cost: number | null; score: number | null; qualified: boolean; eligible: boolean; freshness: string; reliability: string;
}
export interface Backups {
  demand: { id: number; material: string; monthly_tonnes: number; baseline_price: number }; primary: { coverage_pct: number | null; shortfall: number | null } | null;
  options: BackupOption[]; allocation: { plan: { id: number; tonnes: number; qualified: boolean; industry?: NodeRef & { hidden?: boolean } }[]; covered: number; uncovered: number; coverage_pct: number | null; single_source_risk: boolean };
  note: string;
}
export interface RouteRow {
  source: NodeRef & { hidden?: boolean }; waste_stream_id: number; material: string; trust: Trust;
  processor: { id: number; name: string; cluster: string; lat: number; lon: number; output_label: string; yield: number; cost_per_tonne: number; capacity_tpm: number; steps: string[]; source: string; status: string };
  legs_km: [number, number]; input_tonnes: number; usable_tonnes: number; coverage_pct: number | null; capacity_limited: boolean;
  properties_before: AssessedProperty[]; properties_after: AssessedProperty[]; landed_cost_per_usable_tonne: number | null; saving_per_usable_tonne: number | null;
  verdict: string; status: "hypothesis" | "validated_inputs"; unknown_after: number; unresolved: string[]; assumptions: string[];
}
export interface ChecklistItemRow { id: number; position: number; kind: string; title: string; owner: string; due_date: string | null; acceptance_criteria: string | null; status: "open" | "done" | "failed" | "waived"; notes: string | null; completed_by: string | null; completed_at: string | null }
export interface BatchRow {
  id: number; batch_code: string; dispatched_tonnes: number; dispatched_at: string; manifest_ref: string | null; promised_date: string | null; received_tonnes: number | null;
  received_at: string | null; test_values: Record<string, number>; test_date: string | null; accepted_tonnes: number | null; rejected_tonnes: number | null;
  status: string; rejection_reason: string | null; corrective_action: string | null; checks: AssessedProperty[];
}
export interface NetBenefit { status: string; label?: string; tonnes?: number; baseline_avoided?: number; transport_emissions?: number; processing_emissions?: number; net_tco2?: number; formula?: string; basis: string }
export interface ImpactRecordData {
  estimate: NetBenefit; reported: NetBenefit; verified: { status: string; by: string | null; at: string | null; basis: string };
  used_tonnes: number | null; accepted_tonnes: number | null; saving_estimate: number | null; boundary: string;
  factors: Record<string, { value?: number; unit: string; source: string; date: string }>; note: string;
}
export interface TrackRecord { exchanges: number; completed: number; batches: number; delivered_tonnes: number; accepted_tonnes: number; rejection_rate_pct: number | null; evidence_documents: number; evidence_accepted: number; label: string }

// ---------------------------------------------------------------- photos, registries, extraction
export interface PhotoTraits { colour: string; brightness: number; texture: string; moisture_look: string; grain: number; edge_density: number; mean_rgb: number[] }
export interface MaterialPhoto {
  id: number; role: "supply" | "requirement"; waste_stream_id: number | null; demand_id: number | null; url: string; width: number; height: number;
  caption: string | null; traits: PhotoTraits; predicted: { material: string; score: number; method: string }[]; synthetic: boolean; created_at: string; has_embedding: boolean;
}
export interface VisualResult {
  waste_stream_id: number; material: string; trust: Trust; supplier: NodeRef & { hidden?: boolean }; image: MaterialPhoto;
  visual: { overall: number; descriptor: number | null; clip: number | null; method: string };
  traits: { trait: string; yours: string | number | null; theirs: string | number | null; same: boolean }[];
  compatible: boolean; eligibility: string | null; match_id: number | null; match_score: number | null; distance_km: number | null;
  landed_cost_per_usable_tonne: number | null; rank_score: number; conclusion: string; spec_checked?: boolean;
}
export interface VisualMatches {
  demand: { id: number; material: string; monthly_tonnes: number; spec: Record<string, [number, number]> }; reference_images: MaterialPhoto[];
  results: VisualResult[]; method: string; weights: { specification: number; visual: number }; note: string;
}
export interface PhotoSearch {
  traits: PhotoTraits; predicted: { material: string; score: number; method: string }[]; method: string; similar: VisualResult[]; identification: string;
  demand: { id: number; material: string } | null; note: string;
}
export interface ProcessorRow {
  id: number; code: string | null; name: string; cluster: string; lat: number; lon: number; accepts: string[]; output_label: string; sets: Record<string, number>;
  yield: number; cost_per_tonne: number; capacity_tpm: number; steps: string[]; energy_kwh_per_tonne: number | null; hazardous_permitted: boolean;
  source: "synthetic" | "registered"; status: "unconfirmed" | "confirmed"; updated_at: string; operator_industry_id: number | null; unresolved: string[];
}
export interface FactorRow { key: string; label: string; value: number; unit: string; source: string; reference_year: string | null; status: "default" | "reviewed"; updated_by?: string | null; updated_at?: string }
export interface Extraction { values: Record<string, number>; snippets: Record<string, string>; issuer?: string; issue_date?: string; batch_code?: string; test_method?: string; method: string | null; found: number; note: string }

export interface AppNotification { id: number; kind: "exchange" | "sourcing" | "evidence" | "facilitation" | "impact"; title: string; body: string | null; link: string | null; read: boolean; created_at: string; emailed: string | null }
export interface NotificationList { items: AppNotification[]; unread: number; email_alerts: boolean; email_mode: "smtp" | "outbox" }
