# Sylithex (formerly SymbioGraph) - Upgrade Audit

Audit of the repository at commit `ed81096` (18 commits) before the "discover → understand → verify → assess → connect → exchange → complete → measure" upgrade.

Stack: FastAPI + SQLAlchemy 2 + SQLite, NetworkX, OR-Tools GLOP, sentence-transformers (difflib fallback), Anthropic Claude Haiku 4.5 (keyword/template fallback) · React 18 + Vite + TS + Tailwind, TanStack Query, React-Leaflet (OSM), react-force-graph-2d, Recharts. 17 pytest tests, GitHub Actions CI.

## Already Implemented
| Area | Where | Notes |
|---|---|---|
| Hidden by-product inference (KB + LLM + keyword fallback) | `engines/inference.py`, `engines/llm.py` | Streams tagged `declared / kb_inferred / llm_inferred` with confidence + reasoning |
| Name normalisation (embeddings, aliases) | `engines/similarity.py` | Canonical names, dedupe > 0.8 |
| Property-based technical fit | `engines/matching.py` | `exp(-3·dev)`, unknown property = 0.5 (not a pass) |
| Feasibility scoring (tech/econ/CO2/distance/timing) | `engines/scoring.py` | Pure functions, reused by simulator |
| Graph: loops + chains | `engines/graph_engine.py` | Per cluster, best edge ≥ 50 |
| LP allocation + impact | `engines/optimizer.py`, `routers/clusters.py` | Potential impact only |
| What-if simulator | `routers/simulate.py` | In-memory rescoring, dropped matches with reason |
| Reverse search | `routers/search.py` | Material name → substitutes → streams |
| Auth (PBKDF2, bearer sessions), demo logins | `auth.py`, `routers/auth.py` | |
| Deal requests (offer/request, accept/decline, contact reveal) | `routers/inquiries.py`, `Inquiry` model | 2-state workflow only |
| Match explanation (LLM/template) | `engines/explainer.py` | Cached in `matches.explanation` |
| Frontend: dashboard, network, find, simulator, impact, plant profile, match page, signup, login, My Plant, demo tour | `frontend/src/pages` | |

## Partially Implemented
- **Hidden resource discovery**: inferred streams exist but have no *verification state*, no per-property provenance, no assumptions list; UI labels only "AI-discovered".
- **Property-first matching**: compatibility is gated by the substitute *name list*; properties only score candidates that already passed the name gate. No PASS/FAIL/UNKNOWN status.
- **Match explanation**: prose only; no structured *why / why not*, no blockers, no next action.
- **Exchange**: `Inquiry` = interest + accept/decline. No stages, negotiation, agreement, dispatch, receipt, outcome.
- **Reverse search**: requires knowing a material name; no intended-use input, no spec, no gates, no rejected candidates.
- **Impact**: potential only (LP). No committed / verified separation.
- **Economics**: combined saving only; no buyer vs supplier split, no ESTIMATE / USER PROVIDED / VERIFIED labels.
- **Network**: edges have no evidence / exchange status; map and graph become hairballs (193 lines in Tarapur at score ≥ 60, every pair drawn).

## Missing
- Evidence model + upload + verification; evidence completeness score.
- Material Passport.
- Discover Alternatives (intended-use based, gated pipeline).
- Blocker engine (exchange readiness, owner, action).
- Confidential identity + mutual consent; server-side masking.
- Sourcing requests + unconfirmed leads + supplier confirmation.
- Exchange workspace (configurable lifecycle, timeline/audit trail, repeat).
- Material pathways comparison.
- Network opportunity gaps / funnel.
- Facilitator role (verification, outreach).
- Schema migrations (only `create_all`).

## Existing Features That Should Be Reused
- `matching.technical_fit / processing_steps / regulatory_flags / timing` → core of the new assessment engine.
- `scoring.economics` → buyer/supplier split is a re-allocation of the same terms.
- `services.load_candidates` (in-memory pairs) → pathways, gaps, simulator.
- `Inquiry` table → **extended** into the exchange (no parallel Exchange table).
- `similarity.canonical_name / similarity` → semantic candidate discovery.
- `auth.current_user / optional_user` → authorization + masking viewer.
- `AppHeader / StatStrip / Segmented / ScorePill / ClusterMap` UI primitives.

## Duplicate/Conflicting Logic
- Two "supplier finding" paths (`/search/reverse` and industry `top_suppliers`) - the new discovery engine should become the shared pipeline; reverse search stays as the quick mode.
- `inquiry.status` (pending/accepted/declined) vs the new lifecycle stage - keep `status` for compatibility, derive it from consent/stage.
- Transport/CO2 formulas duplicated in `search.py` (inline `dist*4.5`) - move to the assessment engine.

## Recommended Integration Points
- New `engines/assessment.py` (property status, gates, evidence completeness, blockers, why/why-not, two-sided economics) used by: match page, discover alternatives, sourcing candidates, gaps, graph edge status.
- New `privacy.py` applied at every serializer that emits an industry (`queries.node`, industries list/detail, graph nodes, search, passport, exchanges).
- `Inquiry` grows `stage`, `stages`, consents, terms, quantities; `ExchangeEvent` provides the timeline/audit trail.

## Database Changes Required
- `industries.visibility` (public | confidential)
- `waste_streams.verification_status`, `property_sources` (JSON), `assumptions` (JSON), `physical_state`
- `users.role` (company | facilitator)
- `inquiries`: `stage`, `stages`, `supplier_consent`, `buyer_consent`, `agreed_price`, `agreed_tonnes`, `dispatched_tonnes`, `received_tonnes`, `signatures`, `completed_at`, `repeat_of`
- New tables: `evidence`, `exchange_events`, `sourcing_requests`, `sourcing_leads`, `schema_version`
- KB: gypsum demand gets a `purity_pct` spec (currently unknown for all suppliers → must surface as UNKNOWN)

## API Changes Required
`POST /alternatives/discover` · `GET/PATCH /materials/{id}` (passport, owner edits) · `GET /materials/{id}/pathways` · `GET /matches/{id}/assessment` · `POST /evidence`, `GET /evidence/{id}/file`, `POST /evidence/{id}/verify` · `POST/GET /sourcing-requests`, `GET /sourcing-requests/{id}/candidates`, `POST /sourcing-requests/{id}/invite`, `GET /sourcing-leads`, `POST /sourcing-leads/{id}/confirm` · `GET /exchanges`, `GET /exchanges/{id}`, `POST /exchanges/{id}/action`, `POST /exchanges/{id}/comment`, `POST /exchanges/{id}/repeat` · `GET /network/gaps` · `/impact` extended with potential/committed/verified · `PATCH /auth/me/visibility`.

## Frontend Changes Required
- Discover Alternatives (replaces Find Supplier; quick reverse search kept inside).
- Material Passport page with evidence upload (owner) and verification (facilitator).
- Match page: readiness/blockers, PASS/FAIL/UNKNOWN table with provenance, evidence completeness, why/why-not, buyer vs supplier economics.
- Exchange Workspace page (stepper, owner actions, consent, negotiation, dispatch/receipt, timeline, repeat).
- My Plant: exchanges, sourcing requests + incoming leads, visibility toggle, materials.
- Network: edge status, opportunity-gaps funnel, decluttered graph; Dashboard map declutter.
- Impact: potential / committed / verified tiers.
- Demo tour rewritten around the gypsum → phosphogypsum story.

## Risks
- **Confidentiality leaks**: industry names/coords are emitted by ~10 endpoints and cached match dicts; masking must be central and tested.
- **XSS**: force-graph tooltips render HTML strings containing company names (user-controlled after registration) - must escape.
- **Schema drift**: existing local DBs have no migration path; add a versioned, additive migrator.
- **Match id stability**: inquiries reference `matches.id`; recomputation must upsert, not delete-and-recreate.
- **Uploads**: need `python-multipart`, type/size validation, non-public storage, authorization on download.
- **Overclaiming**: inferred streams and estimated economics must never render as confirmed supply or guaranteed savings.
- **Scope**: many features; keep one lifecycle table and one assessment engine to avoid bloat.
