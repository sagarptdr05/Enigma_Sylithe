# Upgrade Summary

## What already existed
Hidden by-product inference (KB + LLM + keyword fallback), embeddings name normalisation, property-based technical fit, 5-factor feasibility score, NetworkX loops/chains, OR-Tools allocation, what-if simulator, reverse search, token auth with demo logins, basic deal requests (offer/request → accept/decline), dashboards, map, network, impact, demo tour. See `UPGRADE_AUDIT.md`.

## What was added
1. **Discover Alternatives**: intended use + current material → ranked, gated alternatives with explanations and rejected candidates (`/discover`).
2. **Trust model for hidden resources**: AI INFERRED / USER DECLARED / VERIFIED / REQUIRES EVIDENCE, per-property provenance, assumptions.
3. **Material Passport** (`/material/:id`): quantity + source, composition with provenance, availability, applications, processing, hazards, permits, evidence, pathways, owner confirmation.
4. **Evidence**: upload (PDF/PNG/JPG/CSV/TXT ≤ 5 MB, magic-byte check, private storage), facilitator verification, evidence completeness per match.
5. **Assessment engine**: PASS / FAIL / FIXABLE / UNKNOWN, 7-8 gates, blocker engine with owner + action, why / why-not, buyer vs supplier economics.
6. **Confidential marketplace**: company visibility, server-side masking across every endpoint, mutual consent reveal.
7. **Exchange Workspace**: configurable 11-stage lifecycle, owner checks, validation (e.g. manifest for hazardous dispatch, receipt ≤ dispatch), timeline/audit trail, comments, repeat.
8. **Sourcing requests**: confirmed vs potential (unconfirmed) suppliers, invite/outreach, supplier confirm/decline.
9. **Material pathways** incl. market routes without a registered buyer.
10. **Network**: edge status, "key links" declutter, opportunity-gap funnel and bottleneck.
11. **Impact tiers**: potential / committed / verified.
12. **Facilitator role** (MIDC Symbiosis Cell) with an evidence verification console.
13. **Demo scenario**: buyer, confidential supplier, facilitator, seeded exchanges at interest / negotiation / dispatch / completed; 13-step guided tour.

## What was changed
- `Inquiry` is now the exchange (extended, not duplicated); `/api/inquiries` kept as a compatible wrapper.
- Match recomputation **upserts** (stable ids for existing exchanges) instead of delete-and-recreate.
- Gypsum demand spec gained `purity_pct` (synced into existing DBs by `sync_kb_specs`).
- Find Supplier → Discover (old `/find` redirects). Dashboard map and network default to key links.
- Match page: 5 separate fit scores incl. evidence completeness, readiness panel, property status table, two-sided economics.

## Database changes (`backend/app/migrations.py`, versioned in `schema_version`)
- v2 (additive): `industries.visibility`; `waste_streams.verification_status, property_sources, assumptions, physical_state`; `users.role`; `inquiries.stage, stages, supplier_consent, buyer_consent, agreed_price, agreed_tonnes, dispatched_tonnes, received_tonnes, signatures, stage_data, completed_at, repeat_of`.
- v3: `users.industry_id` nullable (SQLite table rebuild, data copied) for facilitator accounts.
- New tables: `evidence`, `exchange_events`, `sourcing_requests`, `sourcing_leads`, `schema_version`.
- Clean DB: `create_all` + stamp latest. Existing DB: stepwise upgrade + `backfill()`. Tested on a live v1 database with existing deals (preserved).

## API changes
New: `POST /alternatives/discover` · `GET|PATCH /materials/{id}` · `GET /materials/{id}/pathways` · `POST /materials/{id}/evidence` · `GET /evidence/{id}/file` · `POST /evidence/{id}/verify` · `GET /evidence/pending` · `GET /matches/{id}/assessment` · `POST|GET /exchanges` · `GET /exchanges/{id}` · `POST /exchanges/{id}/action` · `POST /exchanges/{id}/repeat` · `POST|GET /sourcing-requests` · `GET /sourcing-requests/{id}` · `POST /sourcing-requests/{id}/invite` · `GET /sourcing-leads` · `POST /sourcing-leads/{id}/respond` · `GET /network/gaps` · `PATCH /auth/me/visibility`.
Changed: `/impact` adds `tiers`; `/graph` edges add `status`; match/industry payloads add `trust`, `property_sources`, `assumptions`; all industry-bearing payloads are masked for confidential companies. OpenAPI docs: `http://localhost:8000/docs`.

## Frontend changes
New pages: Discover, Material Passport, Exchange Workspace, Facilitator console. New components: `ReadinessPanel`, `EvidenceBlock`, `WhyPanel`, `PropertyTable`, `TwoSidedEconomics`, `ExchangeModal`, trust/status/basis badges. Updated: Match page, My Plant (exchanges, sourcing, visibility), Network (status, declutter, gaps), Dashboard (declutter), Impact (tiers), plant profile (trust labels), demo tour.

## AI changes
LLM output sanitised (HTML stripped, names ≤ 80 chars, reasoning ≤ 300, confidence clamped 0-1, tonnage bounded ≥ 0 and ≤ 50× capacity, malformed JSON → []), always tagged `ai_inferred` with assumptions. Cached LLM explanations are never served when names are masked. Discovery uses no LLM calls per candidate (deterministic gates after embedding lookup).

## Security changes
Server-side confidentiality masking (names, exact coordinates → ~5 km grid, contacts, process text) across JSON, graph metadata and loops; 404 (not 403) on foreign exchanges (IDOR); owner-only material edits and evidence upload; facilitator-only verification; evidence files only for owner / facilitator / mutually-consented counterparty; upload type, magic-byte and size checks with random stored names outside any static path; HTML-escaped graph tooltips (company names are user input); Pydantic validation on every body; every state transition written to `exchange_events`.

## Tests
`backend/tests`: 31 passing: scoring (12), optimizer (3), API end-to-end (1), auth/deal flow (1), upgrade (14): property PASS/FAIL/UNKNOWN, FIXABLE vs UNKNOWN, insufficient quantity, distance, negative economics, hazardous + missing evidence blockers, evidence provenance, two-sided economics sum, discovery of phosphogypsum with purity blocker, confidentiality across 7 endpoints, one-sided vs mutual consent, IDOR + upload validation + file authorisation + facilitator-only verify, full lifecycle incl. invalid transitions and impact tiers + repeat, sourcing leads unconfirmed + access control, gaps funnel monotonic + edge status, LLM malformed/hallucinated/missing-key. Frontend: `npm run build` (type-checked).

## Known limitations
- Evidence values are extracted from text PDFs automatically; scanned images need the optional API key. Values stay "Document" until a facilitator verifies.
- Transfer price split is indicative (35% of virgin price) until parties agree a price.
- Market pathways use indicative national price ranges.
- SQLite + additive migrator; production should move to PostgreSQL + Alembic.
- One-click demo logins (and the demo-accounts list, which names the confidential demo supplier) exist only when `DEMO_LOGIN=1`.
- Notifications poll every 15 s (no WebSocket push); desktop pop-ups need the site open in a tab.

## Demo flow
Click **Demo Mode**: (1) Raigad Cement buys virgin gypsum → (2) Discover alternatives → (3) phosphogypsum found → (4) gates, value, evidence → (5) ⚠ purity UNKNOWN, blocker owner supplier → (6) material passport → (7) supplier confidential → (8) buyer expresses interest → (9) supplier consents, identities revealed → (10) lab report uploaded, evidence submitted → (11) assessment + sample pass, offer ₹750/t → (12) network with statuses, chains and gaps → (13) potential / committed / verified impact.


---

# Upgrade 2: buyer-side execution + professional UI

## Added
- **True landed cost** per usable tonne (`engines/costing.py`) with sensitivity, break-even distance, exclusions and an editable calculator.
- **Supply assurance**: availability freshness, min order, delivery window, 12-month supply history, delivery reliability, coverage/shortfall, capacity-safe backup allocation, single-source risk (`engines/supply.py`, `supply_records`).
- **Qualification**: eligibility separate from score, factor weights/contributions, evidence states incl. expiry and revalidation (`engines/qualification.py`).
- **Trial planner**: checklist generated from real gaps, buyer-only approval (`checklist_items`).
- **Batch records**, deviations and corrective actions; accepted vs rejected vs used tonnes (`batches`).
- **Responsibility tracker** and acceptance criteria on exchanges.
- **Missing-link discovery** through 7 synthetic processors with yield and capacity (`engines/routes.py`, `data/processors.json`).
- **Impact tracker**: estimate / reported / independently verified per exchange; 4 impact tiers (potential, committed, reported, verified) with net CO2.
- **Time Machine** levers: processing cost, supplier output, buyer demand, minimum quality fit (defaults keep previous behaviour).
- **Facilitator**: impact verification, help requests.
- `/showcase` endpoint for live links from explanatory pages; **How Sylithex works** page.

## Changed
- Schema v4 (additive migration): stream supply fields, evidence metadata, exchange responsibilities/impact fields, new `batches`, `supply_records`, `checklist_items` tables.
- Expired or stale evidence no longer counts toward evidence completeness.
- Impact "verified" now means independently verified by a facilitator; buyer-recorded results are "reported".
- Embedding calls serialised and pinned to CPU (fixes a process-wide hang under concurrent discovery requests).

## UI/UX
Left sidebar app shell (Overview · Source & evaluate · My workspace · Help), light page headers, Inter typography, 8 px radius, bordered tables, no decorative gradients or glow; match and exchange pages organised into tabs; landing page with a live product preview computed from demo data; 16-step guided demo.

## Tests
`pytest`: 43 passing (12 new for costing, supply, allocation, evidence states, eligibility, checklist generation, Time Machine levers, qualification/backups/routes API, batch rejection & partial acceptance, terms reset, availability refresh authorisation).


---

# Upgrade 3: real inputs + photo matching

## Limitations addressed
| Previous limitation | Now |
|---|---|
| Processors were synthetic JSON | `processors` table: operators register facilities (`POST /processors`), confirm figures (`POST /processors/{id}/confirm`); edits reset status to unconfirmed. Seeded examples stay labelled *example* and only a facilitator can confirm them. Routes show source and status; a route through a confirmed facility is `validated_inputs`, otherwise `hypothesis` |
| Supply history was synthetic | Receiving a batch in an exchange writes a platform supply record; reliability uses platform deliveries first (`basis: platform`), then supplier-reported history, and shows acceptance % |
| Emission factors were illustrative | `emission_factors` table with value, unit, source, year and status (default / reviewed). Transport = diesel × fuel intensity per t-km; processing = step kWh/t × grid factor. Facilitator edits (`PATCH /factors/{key}`) recompute all matches. Impact records list the factors used |
| Evidence values typed manually | `POST /evidence/extract` reads PDF/TXT/CSV lab reports (pypdf + regex, unit conversion e.g. kcal/kg → MJ/kg) and pre-fills values, issuer, dates, method; optional Claude vision for images. `evidence.extraction_method` records how values were entered |

## Photo matching (new)
- Suppliers upload photos on the material passport; buyers upload reference photos per requirement (`POST /materials/{id}/images`, `POST /demands/{id}/images`; owner only).
- Descriptor: HSV colour histogram, brightness, edge density and coarseness → traits (colour, texture, particle size, damp/dry look). Optional CLIP embedding (`USE_CLIP=1`, loaded in the background) adds 40% to visual similarity and a zero-shot guess restricted to photographable materials (shown only above 50% confidence).
- `GET /demands/{id}/visual-matches`: candidates ranked by 65% specification fit + 35% appearance; spec-incompatible look-alikes are listed after compatible materials with the reason.
- `POST /vision/search`: search with any photo (optionally against a requirement).
- Uploads: magic-byte check, 5 MB limit, re-encoded to JPEG (EXIF/GPS removed), random names outside static paths.

## Database
Schema v5: new tables `processors`, `emission_factors`, `material_images`; `evidence.extraction_method`.

## Tests
`pytest`: 54 passing (11 new: extraction, EXIF stripping, owner-only uploads, visual ranking keeps spec in charge, photo search, processor register/confirm permissions, factor registry and recompute, processing emissions, platform reliability).


---

# Upgrade 4: notifications

- **In-app:** `notifications` table (per user, read state). Bell in the sidebar and mobile header with unread badge, list, mark read / mark all read; unread count in the browser tab title. Polls every 15 s, also in background tabs.
- **Events:** new offer/request, every exchange action (consent, evidence, assessment, offers, signing, dispatch, receipt, acceptance, comments, withdrawals, impact verification) goes to the other party; help requests also to facilitators; sourcing invites to the inferred supplier and replies to the buyer; new evidence to facilitators; evidence accepted/rejected to the owner. Text never includes company names (confidential mode stays intact).
- **Email:** per-user preference (`users.email_alerts`, schema v6). SMTP when `SMTP_HOST` is set, otherwise `.eml` files in `backend/outbox/` (git-ignored). Sent from a background thread so actions never wait on mail.
- **Desktop pop-ups:** browser Notification API after the user turns it on; shown for new alerts while the tab is hidden; clicking opens the item.
- **API:** `GET /notifications`, `POST /notifications/read`, `PATCH /notifications/preferences`.
- **Tests:** 58 passing (4 new: counterpart-only alerts and no names, per-user read state, facilitator alert on help request, outbox email and preference, sourcing/evidence alerts, login required).
