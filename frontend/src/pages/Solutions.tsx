import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import AppHeader, { AppPage } from "../components/layout/AppHeader";
import { api } from "../api/client";

interface Showcase { match_id: number | null; material_id: number | null; completed_exchange_id: number | null }
type Row = { n: number; problem: string; detail: string; feature: string; what: string[]; where: string; link: (s: Showcase) => string };

const JOURNEY = ["Discover", "Screen", "Qualify", "Calculate cost", "Trial", "Agree", "Exchange", "Measure impact"];

const ROWS: Row[] = [
  { n: 1, problem: "The material matches on paper but a delivered batch fails", detail: "Average composition looks fine; the batch that arrives has different moisture, chemistry or contamination.",
    feature: "Batch quality records", what: ["Every dispatch is a traceable batch with its own test results", "Results compared with the agreed acceptance criteria: PASS / FAIL / UNKNOWN", "Accepted and rejected tonnes recorded separately, with the rejection reason and corrective action"],
    where: "Exchange → Deliveries & batches", link: (s) => (s.completed_exchange_id ? `/exchange/${s.completed_exchange_id}?tab=deliveries` : "/my?tab=exchanges") },
  { n: 2, problem: "Supply is not steady enough for continuous production", detail: "By-product output follows the supplier's main process and changes month to month.",
    feature: "Supply assurance & backup finder", what: ["Coverage and shortfall against your demand", "12-month availability history and delivery reliability (or “reliability not established”)", "Backup sources allocated without exceeding any supplier's capacity; single-source risk flagged"],
    where: "Match → Supply & backups", link: (s) => (s.match_id ? `/match/${s.match_id}?tab=supply` : "/discover") },
  { n: 3, problem: "The delivered cost is higher than the quoted price", detail: "Freight, loading, storage, drying, testing and rejected loads are left out of the headline price.",
    feature: "True landed cost calculator", what: ["Cost per usable tonne after acceptance and processing losses", "Compared with the conventional material on the same basis", "Sensitivity, break-even distance, assumptions and exclusions shown; no saving claimed when inputs are missing"],
    where: "Match → True landed cost", link: (s) => (s.match_id ? `/match/${s.match_id}?tab=cost` : "/discover") },
  { n: 4, problem: "Quality, origin or compliance can't be verified", detail: "Test reports, safety data, permits and source records are missing, old or unclear.",
    feature: "Material passport & evidence readiness", what: ["Every property shows its source: AI inferred, user reported, document or lab verified", "Evidence with issuer, issue and expiry dates: under review, accepted, expired or revalidation required", "Hazardous materials list the permits required before dispatch"],
    where: "Material passport", link: (s) => (s.material_id ? `/material/${s.material_id}` : "/discover") },
  { n: 5, problem: "Using the material needs production changes", detail: "Storage, feeding, process settings or trials may be needed before adoption.",
    feature: "Production compatibility & trial planner", what: ["A checklist generated from the actual specification gaps, missing documents and processing steps", "Sample, lab tests, production review and a controlled trial, each with owner, due date and acceptance criteria", "Final approval only by the buyer's authorised reviewer; the platform never approves use"],
    where: "Exchange → Qualification & trial plan", link: (s) => (s.completed_exchange_id ? `/exchange/${s.completed_exchange_id}?tab=plan` : "/my?tab=exchanges") },
  { n: 6, problem: "The buyer can't trust or commit to an unfamiliar supplier", detail: "Supply claims may be old; sensitive data may leak; the supplier may not prioritise the exchange.",
    feature: "Track record, controlled sharing & facilitation", what: ["Supplier history built only from batches delivered on Sylithex", "Confidential mode: identity revealed only when both sides consent", "One-click request for a human facilitator when an exchange stalls"],
    where: "Material passport & exchange", link: (s) => (s.material_id ? `/material/${s.material_id}` : "/discover") },
  { n: 7, problem: "Nobody knows who is responsible when something goes wrong", detail: "Late deliveries, nonconforming batches, testing, transport and disposal of rejected loads.",
    feature: "Responsibility tracker", what: ["Responsibilities agreed per topic before signing (supplier, buyer or shared)", "Acceptance criteria written into the exchange", "Changing terms after signing resets signatures; deviations stay on the timeline"],
    where: "Exchange → Responsibilities", link: (s) => (s.completed_exchange_id ? `/exchange/${s.completed_exchange_id}?tab=terms` : "/my?tab=exchanges") },
  { n: 8, problem: "Listings and material data go stale", detail: "Historical output shown as current availability; old test reports.",
    feature: "Freshness labels", what: ["Every quantity says when it was last confirmed, or that it was never confirmed", "Availability older than 90 days is flagged as stale", "AI-inferred supply is never shown as confirmed stock"],
    where: "Discover, match and passport", link: () => "/discover" },
  { n: 9, problem: "Environmental benefits are never demonstrated after the exchange", detail: "A model estimate is reported as if it were a measured result.",
    feature: "Exchange impact tracker", what: ["Estimate, buyer-reported and independently verified results kept separate", "Net CO2 = virgin production avoided − transport − processing, with factors, sources and boundary", "Accepted and used quantities recorded; no carbon-credit claims"],
    where: "Impact page and exchange → Impact", link: () => "/impact" },
  { n: 10, problem: "There is no qualified backup and no direct match", detail: "One promising supplier, or a material that only works after processing.",
    feature: "Missing-link discovery", what: ["Routes through processing facilities with yield, capacity, both transport legs and landed cost", "Properties shown before and after processing", "Every route labelled a hypothesis with its unresolved checks"],
    where: "Match → Processing routes", link: (s) => (s.match_id ? `/match/${s.match_id}?tab=routes` : "/discover") },
];

export default function Solutions() {
  const sc = useQuery({ queryKey: ["showcase"], queryFn: () => api.get<Showcase>("/showcase").then((r) => r.data) });
  const s = sc.data ?? { match_id: null, material_id: null, completed_exchange_id: null };
  return (
    <AppPage header={<AppHeader eyebrow="Help / How Sylithex works" title="From a promising match to a qualified, costed, tracked exchange"
      description="A compatibility score alone does not tell a buyer whether a material can be used safely, reliably and profitably. Sylithex is built around the ten practical reasons industrial by-product exchanges stall, and makes each one visible and actionable." />}>
      <section className="card p-5 mb-6">
        <div className="section-title mb-3">The journey Sylithex supports</div>
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {JOURNEY.map((j, i) => <li key={j} className="flex items-center gap-2"><span className="rounded-md border border-border bg-subtle px-2.5 py-1"><span className="text-muted mr-1">{i + 1}</span>{j}</span>{i < JOURNEY.length - 1 && <ArrowRight size={14} className="text-muted" />}</li>)}
        </ol>
      </section>
      <div className="card overflow-hidden">
        <div className="grid md:grid-cols-[1fr_1.4fr] bg-subtle border-b border-border text-[11px] uppercase tracking-wide text-muted font-medium">
          <div className="px-5 py-2.5">Why exchanges stall</div><div className="px-5 py-2.5 border-l border-border">What Sylithex does about it</div>
        </div>
        {ROWS.map((r) => (
          <div key={r.n} className="grid md:grid-cols-[1fr_1.4fr] border-b border-border last:border-0">
            <div className="px-5 py-4">
              <div className="flex gap-3"><span className="text-muted tabular-nums text-sm w-5 shrink-0">{r.n}</span>
                <div><div className="font-semibold text-[15px]">{r.problem}</div><p className="text-sm text-muted mt-1">{r.detail}</p></div></div>
            </div>
            <div className="px-5 py-4 md:border-l border-border">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-[15px] text-brand">{r.feature}</div>
                <Link to={r.link(s)} className="btn-link text-xs inline-flex items-center gap-1">Open: {r.where} <ArrowRight size={12} /></Link></div>
              <ul className="mt-2 space-y-1 text-sm text-ink/85">{r.what.map((w) => <li key={w} className="flex gap-2"><span className="text-emerald mt-[3px]">✓</span>{w}</li>)}</ul>
            </div>
          </div>
        ))}
      </div>
      <section className="grid md:grid-cols-2 gap-5 mt-6">
        <div className="card p-5"><div className="section-title">Also built in</div>
          <ul className="mt-2 space-y-1.5 text-sm text-ink/85">
            <li><b>Discover alternatives</b>: describe the use, not the waste name.</li>
            <li><b>Explainability</b>: eligibility shown separately from the ranking score, with each factor's weight and contribution.</li>
            <li><b>Time Machine</b>: change freight, prices, processing cost, supply, demand or the quality threshold and recalculate everything.</li>
            <li><b>Exchange workspace</b>: interest → evidence → assessment → sample → trial → agreement → dispatch → receipt → acceptance.</li>
          </ul></div>
        <div className="card p-5"><div className="section-title">What Sylithex does not claim</div>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            <li>Demo companies and figures are illustrative, not real industrial data.</li>
            <li>A rule-based fit does not replace laboratory testing or engineering review.</li>
            <li>An uploaded document is not proof of authenticity or legal compliance.</li>
            <li>A processing route is a hypothesis until capacity, cost and properties are confirmed.</li>
            <li>Environmental results are estimates unless independently verified; none are carbon credits.</li>
          </ul></div>
      </section>
    </AppPage>
  );
}
