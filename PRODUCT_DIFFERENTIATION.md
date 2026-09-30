# Sylithex - Product Differentiation

**Positioning (a product claim, not a global-uniqueness claim):** Sylithex combines alternative-material discovery, hidden resource inference, property-first matching, evidence-gated feasibility, confidential exchange and a transaction workflow in one industrial-symbiosis platform. It takes an opportunity through **discover → understand → verify → assess → connect → exchange → complete → measure impact**, where a typical marketplace stops at *listing → search → match → contact*.

Each row: existing platform → current gap → new feature → user problem solved → implementation.

| # | Existing platform | Gap | New feature | Problem solved | Implementation |
|---|---|---|---|---|---|
| A | Reverse search needed a material name | Buyers don't know what alternative to ask for | **Discover Alternatives** | Buyer describes the *use* ("cement production", "virgin gypsum", 500 t/month) and gets phosphogypsum / chemical gypsum with reasons | `engines/discovery.py`, `POST /api/alternatives/discover`, `/discover` page |
| B | KB/LLM inference produced "AI-discovered" streams | Inferred supply looked like inventory | **Hidden resource discovery with a trust model** | Companies see what they probably generate; buyers never mistake a guess for stock | `waste_streams.verification_status`, `property_sources`, `assumptions`; badges AI INFERRED / USER DECLARED / VERIFIED / REQUIRES EVIDENCE |
| C | Name list gated compatibility | Names are unreliable | **Property-first candidate routes** | A material is proposed because its composition overlaps the spec, not only because its name matches | Three discovery routes (substitute list, property overlap, name/semantic); all candidates judged on the same spec |
| D | One score 0-100 | A high score hid missing facts | **PASS / FAIL / FIXABLE / UNKNOWN property table** | Unknown purity is shown as UNKNOWN (never PASS); moisture fixed by drying is FIXABLE | `engines/assessment.py::property_rows` |
| E | No evidence model | Missing quality data was invisible | **Evidence-gated matching** + **Evidence completeness** | Every match shows what is proven and what is missing, with owner and next action | `evidence` table, upload/verify APIs, `evidence_requirements()` |
| F | All identities public | Plants don't want to expose waste data | **Confidential marketplace + mutual reveal** | Supplier listed as "Confidential supplier · Taloja region" until both sides consent | `industries.visibility`, `privacy.py` server-side masking, consent flags on exchanges |
| G | Accept/decline inquiry | A match is not a transaction | **Exchange Workspace** | Interest → evidence → assessment → sample → trial → negotiation → agreement → dispatch → receipt → acceptance → completed, with owners, validation and audit trail | `Inquiry` extended (no duplicate table), `engines/exchange.py`, `routers/exchanges.py`, `/exchange/:id` |
| H | No supplier → dead end | Marketplace useless without listings | **Sourcing requests** | Inferred plants appear as *Potential supplier - not yet confirmed*; they confirm availability themselves | `sourcing_requests`, `sourcing_leads`, confirm/decline API |
| I | One best match per pair | A material may have several outlets | **Material pathways** | Slag → cement / road aggregate / metal recovery compared on fit, processing, value, CO2, evidence and permits, without declaring a "best" | `GET /api/materials/{id}/pathways`, `data/pathways.json` |
| J | Prose explanation | Users can't see why something failed | **Why this match / Why not / Blocker engine** | "Main blocker: purity not yet known → Owner: supplier → Action: upload lab report" | Gates + blockers in `assess()`; discovery lists rejected candidates with ✗ reasons |
| - | Combined saving | One-sided economics | **Buyer vs supplier economics** | Both parties see their own net, labelled ESTIMATE / USER PROVIDED / VERIFIED | Split of the same cost terms by an indicative transfer price |
| - | Graph of inferred edges | Inferred links looked like trade | **Edge status** INFERRED → POTENTIAL → ASSESSED → AGREED → ACTIVE → COMPLETED | Network shows what is real | `routers/graph.py::edge_status` |
| - | Loops and chains only | Graph doesn't say what to fix | **Opportunity gaps** funnel and bottleneck | "564 economically feasible, 6 evidence-ready: bottleneck is evidence" | `GET /api/network/gaps` |
| - | Potential impact only | Estimates mixed with reality | **Impact traceability** | Potential, committed and verified shown separately, never summed | `impact_tiers()` |
| - | One-off deals | No memory | **Repeat exchange** | Completed exchange re-opens with terms and proven spec carried over | `POST /api/exchanges/{id}/repeat` |

## What the AI does and does not do
- **LLM (Claude Haiku 4.5, optional):** interprets process text into candidate by-products; writes plain-English summaries. Output is sanitised (tags stripped, confidence clamped, quantities bounded) and always labelled AI INFERRED.
- **Embeddings:** name normalisation and application matching.
- **Deterministic code:** property checks, gates, distance, economics, quantities, carbon, eligibility, regulatory flags, evidence completeness, exchange rules.
- **Never invented:** quantities are marked as estimates until the company confirms; lab values come only from uploaded evidence; verification only from a facilitator; prices are estimates until parties agree.

Trust hierarchy: verified evidence → user-provided data → database knowledge → deterministic calculation → AI inference.


## Buyer-side execution: why matches stall, and what Sylithex does

A compatibility score does not tell a buyer whether a material can be used **safely, reliably and profitably**. Sylithex treats the ten practical reasons exchanges stall as core features (see the in-app page *How Sylithex works*, `/solutions`).

| # | Why exchanges stall | Sylithex feature | Where | Implementation |
|---|---|---|---|---|
| 1 | Material matches on paper, delivered batch fails | **Batch quality records**: batch ID, test values vs acceptance criteria (PASS/FAIL/UNKNOWN), accepted vs rejected tonnes, rejection reason, corrective action | Exchange → Deliveries & batches | `batches` table; dispatch/receive/accept actions |
| 2 | Supply not steady enough | **Supply assurance & backup finder**: coverage/shortfall, 12-month history, reliability (or "not established"), capacity-safe allocation, single-source risk | Match → Supply & backups; Discover | `engines/supply.py`, `supply_records`, `GET /matches/{id}/backups` |
| 3 | Delivered cost exceeds the quote | **True landed cost per usable tonne**: freight, loading, handling, storage, processing, testing, rejected loads, yields; baseline comparison, sensitivity, break-even distance, exclusions; no saving claimed if inputs are missing | Match → True landed cost | `engines/costing.py`, `POST /matches/{id}/landed-cost` |
| 4 | Quality / compliance can't be verified | **Evidence readiness**: issuer, issue/expiry date, batch, test method; states under review / accepted / rejected / expired / revalidation required; expired or stale tests don't count | Material passport | `evidence` columns, `qualification.evidence_state` |
| 5 | Production changes needed | **Production compatibility & trial planner**: checklist generated from spec gaps, missing evidence and processing steps; owner, due date, criteria; buyer-only approval | Exchange → Qualification & trial plan | `checklist_items`, `qualification.generate_checklist` |
| 6 | Supplier not trusted | **Track record** (from platform batches only), **confidential mode + mutual reveal**, **request a facilitator** | Passport, plant page, exchange | `buyer.track_record`, `request_facilitation` |
| 7 | Responsibility unclear | **Responsibility tracker**: per-topic owner, acceptance criteria, signatures reset on change, deviations on the timeline | Exchange → Responsibilities | `inquiries.responsibilities`, `set_terms` |
| 8 | Listings go stale | **Freshness labels**: confirmed N days ago / stale (>90 days) / never confirmed; owner refresh with min order and delivery window | Discover, match, passport | `availability_updated_at`, `POST /materials/{id}/availability` |
| 9 | Benefits never demonstrated | **Impact tracker**: pre-exchange estimate, buyer-reported, independently verified; net CO2 = avoided − transport − processing, with factors, sources, boundary | Exchange → Impact; Impact page (4 tiers) | `engines/impact.py`, `verify_impact` |
| 10 | No backup, no direct match | **Missing-link discovery**: processor routes with yield, capacity, two transport legs, before/after properties, landed cost; always labelled a hypothesis | Match → Processing routes; Discover | `engines/routes.py`, `data/processors.json` |

Also: **eligibility shown separately from the ranking score** (a critical specification failure blocks eligibility whatever the score), each factor's value, weight and contribution, and the **Time Machine** (freight, carbon price, conventional prices, processing cost, supply, demand, minimum quality fit) calling the same engine without touching stored records.

## Real inputs and photo matching

| Feature | Problem solved | Implementation |
|---|---|---|
| **Photo match** | Buyers often recognise a material by look before they know its chemistry; suppliers can show what they actually generate | `engines/vision.py` (colour/texture descriptor + optional CLIP), `routers/visual.py`, `/photos`; specification stays in charge (65/35) |
| **Processing facility registry** | Missing-link routes need real facilities, not examples | `processors` table, operator confirmation, status on every route |
| **Emission factor registry** | Carbon claims need traceable factors | `emission_factors` table, source/year/status, facilitator review, recompute |
| **Lab-report extraction** | Typing lab values invites errors | `engines/extraction.py`, `POST /evidence/extract` |
| **Platform delivery history** | Reliability should come from real deliveries | Batches received on the platform feed `supply_records` (`basis: platform`) |
