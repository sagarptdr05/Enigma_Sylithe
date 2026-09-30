import { Link } from "react-router-dom";
import { ArrowRight, Building, Factory, Landmark, Network, PlayCircle, Sprout, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, useClusters, useImpact } from "../api/client";
import { useDemo } from "../context/DemoContext";
import { PropStatusBadge } from "../components/cards/Badges";
import { inr, num } from "../lib/format";
import type { AssessedProperty, Blocker, Eligibility } from "../types";

interface Preview { material: string; replaces: string; buyer: string; supplier: string; properties: AssessedProperty[]; eligibility: Eligibility; evidence: number; landed: number | null; baseline: number | null; main_blocker: Blocker | null }

const PROBLEMS: [string, string][] = [
  ["A batch fails even though the match looked right", "Batch quality records"], ["Supply is not steady enough", "Supply assurance & backups"],
  ["Delivered cost exceeds the quoted price", "True landed cost"], ["Quality and compliance can't be verified", "Passport & evidence readiness"],
  ["Production changes are needed", "Trial planner"], ["The supplier isn't trusted yet", "Track record & controlled sharing"],
  ["Responsibility is unclear when things go wrong", "Responsibility tracker"], ["Listings are out of date", "Freshness labels"],
  ["Benefits are never demonstrated", "Impact tracker"], ["No backup and no direct match", "Missing-link routes"],
];
const JOURNEY = ["Discover", "Screen", "Qualify", "Calculate cost", "Trial", "Agree", "Exchange", "Measure impact"];
const CONTEXTS = [
  { key: "heavy", title: "Heavy industry", icon: Factory, cluster: "Tarapur MIDC", text: "Slag, fly ash, mill scale and phosphogypsum into cement and bricks." },
  { key: "agro", title: "Agro-industry", icon: Sprout, cluster: "Kolhapur Agro Belt", text: "Bagasse, press mud and spent wash into paper, fertilizer and fuel." },
  { key: "urban", title: "Urban", icon: Building, cluster: "Pune-Chakan Urban", text: "Data-centre heat, food waste and CO2 into greenhouses and biogas." },
];
const USERS = [
  { icon: Factory, title: "Plant, procurement & EHS teams", text: "Qualify substitutes, cost them properly and track every delivery." },
  { icon: Landmark, title: "Industrial parks (MIDC)", text: "See which exchanges are stuck and why: evidence, processing or distance." },
  { icon: Users, title: "Pollution control boards", text: "Hazardous by-products routed to permitted reuse with manifests on record." },
  { icon: Network, title: "Processors & facilitators", text: "Find volumes that become usable after drying, grinding or regeneration." },
];

function ProductPreview() {
  const q = useQuery({ queryKey: ["showcase"], queryFn: () => api.get<{ match_id: number | null; preview: Preview | null }>("/showcase").then((r) => r.data) });
  const p = q.data?.preview;
  if (!p) return <div className="card h-[420px] animate-pulse bg-subtle" />;
  const cls = p.eligibility.status === "eligible" ? "text-emerald" : p.eligibility.status === "conditional" ? "text-amber" : "text-danger";
  return (
    <div className="card shadow-pop overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-subtle/60">
        <div className="text-xs text-muted">Match analysis · live example from the demo data</div>
        <span className={`text-xs font-semibold ${cls}`}>{p.eligibility.label}</span>
      </div>
      <div className="p-5">
        <div className="text-lg font-semibold">{p.material} <span className="text-muted font-normal">→</span> {p.replaces}</div>
        <div className="text-xs text-muted">{p.supplier} → {p.buyer}</div>
        <table className="table mt-4 text-[13px]">
          <thead><tr><th className="!px-2">Property</th><th className="!px-2">Actual</th><th className="!px-2">Required</th><th className="!px-2">Result</th></tr></thead>
          <tbody>{p.properties.map((r) => <tr key={r.property}><td className="!px-2">{r.label}</td><td className="!px-2 tabular-nums">{r.actual ?? "Unknown"}</td><td className="!px-2 text-muted tabular-nums">{r.min}-{r.max}</td><td className="!px-2"><PropStatusBadge status={r.status} /></td></tr>)}</tbody>
        </table>
        <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
          <div className="rounded-md border border-border p-2.5"><div className="text-[11px] text-muted">Landed / usable t</div><div className="font-semibold tabular-nums">{p.landed != null ? inr(p.landed) : "-"}</div></div>
          <div className="rounded-md border border-border p-2.5"><div className="text-[11px] text-muted">Conventional</div><div className="font-semibold tabular-nums">{p.baseline != null ? inr(p.baseline) : "-"}</div></div>
          <div className="rounded-md border border-border p-2.5"><div className="text-[11px] text-muted">Evidence</div><div className="font-semibold tabular-nums text-amber">{Math.round(p.evidence * 100)}%</div></div>
        </div>
        {p.main_blocker && <div className="mt-4 rounded-md border border-amber/30 bg-amber-soft px-3 py-2.5 text-[13px]">
          <div className="text-[11px] uppercase tracking-wide text-amber font-semibold">Next step before an exchange</div>
          <div className="mt-0.5">{p.main_blocker.action ?? p.main_blocker.text} <span className="text-muted">· owner: {p.main_blocker.owner}</span></div></div>}
        {q.data?.match_id && <Link to={`/match/${q.data.match_id}`} className="btn-link text-sm inline-flex items-center gap-1 mt-4">Open the full analysis <ArrowRight size={14} /></Link>}
      </div>
    </div>
  );
}

export default function Landing() {
  const impact = useImpact();
  const clusters = useClusters();
  const demo = useDemo();
  const d = impact.data;
  return (
    <main>
      <section className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-5 py-14 md:py-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
          <div>
            <div className="text-sm font-medium text-emerald">Industrial symbiosis platform · ENIGMA 5.0, Sustainability PS 5</div>
            <h1 className="text-4xl md:text-[52px] leading-[1.08] font-semibold text-brand mt-3 tracking-tight">Turn industrial by-products into qualified, costed raw-material supply.</h1>
            <p className="mt-5 text-lg text-muted max-w-xl leading-relaxed">
              Sylithex finds by-products a plant never declared, matches them to buyers by chemistry, and takes each opportunity through
              qualification, landed cost, supply assurance, trials and delivery, so a promising match becomes an exchange you can depend on.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="btn-primary h-11 px-5 text-[15px]">Register your plant <ArrowRight size={16} /></Link>
              <button onClick={() => { demo.setStep(0); demo.setActive(true); }} className="btn-ghost h-11 px-5 text-[15px]"><PlayCircle size={16} /> Take the guided demo</button>
            </div>
            {d && <dl className="mt-10 grid grid-cols-3 gap-6 max-w-lg">
              <div><dt className="text-xs text-muted">Potential value / yr</dt><dd className="text-xl font-semibold tabular-nums mt-0.5">{inr(d.saving_per_year)}</dd></div>
              <div><dt className="text-xs text-muted">CO2 avoidable / yr</dt><dd className="text-xl font-semibold tabular-nums mt-0.5">{num(d.co2_per_year)} t</dd></div>
              <div><dt className="text-xs text-muted">Viable exchanges</dt><dd className="text-xl font-semibold tabular-nums mt-0.5">{num(d.matches)}</dd></div>
              <p className="col-span-3 text-[11px] text-muted -mt-3">Model estimates across {d.industries} illustrative plants in four Maharashtra clusters.</p>
            </dl>}
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 py-16">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold text-brand">A match is not an exchange</h2>
          <p className="text-muted mt-3">Most opportunities stall after discovery. Sylithex is built around the ten practical reasons they stall, and gives each one a working answer.</p>
        </div>
        <div className="mt-8 grid md:grid-cols-2 border border-border rounded-lg overflow-hidden bg-surface">
          {PROBLEMS.map(([p, f], i) => (
            <div key={p} className={`flex items-start gap-4 px-5 py-4 border-border ${i % 2 === 0 ? "md:border-r" : ""} ${i < PROBLEMS.length - 2 ? "border-b" : i === PROBLEMS.length - 2 ? "border-b md:border-b-0" : ""}`}>
              <span className="text-sm text-muted tabular-nums w-5">{i + 1}</span>
              <div className="flex-1"><div className="text-[15px] font-medium">{p}</div><div className="text-sm text-emerald mt-0.5">→ {f}</div></div>
            </div>
          ))}
        </div>
        <Link to="/solutions" className="btn-link inline-flex items-center gap-1 mt-4">See how each one works <ArrowRight size={14} /></Link>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-5 py-14">
          <h2 className="text-2xl font-semibold text-brand">One connected workflow</h2>
          <ol className="mt-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {JOURNEY.map((j, i) => <li key={j} className="rounded-lg border border-border px-3 py-3"><div className="text-xs text-muted">Step {i + 1}</div><div className="text-sm font-medium mt-0.5">{j}</div></li>)}
          </ol>
          <p className="text-sm text-muted mt-4 max-w-3xl">Every number on every page (fit, landed cost, coverage, routes, scenarios and impact) comes from the same calculation engine, so what the buyer sees in discovery is what the exchange is tracked against.</p>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 py-16 grid lg:grid-cols-2 gap-12">
        <div>
          <h2 className="text-2xl font-semibold text-brand">Three industrial contexts</h2>
          <div className="mt-6 space-y-3">
            {CONTEXTS.map((c) => {
              const k = clusters.data?.filter((x) => x.context === c.key) ?? [];
              return (
                <Link key={c.key} to={`/dashboard?cluster=${encodeURIComponent(c.cluster)}`} className="card card-hover p-4 flex gap-4 items-start">
                  <c.icon size={20} className="text-brand mt-0.5" />
                  <div className="flex-1"><div className="font-medium">{c.title}</div><p className="text-sm text-muted">{c.text}</p>
                    <div className="text-xs text-muted mt-1">{k.map((x) => `${x.name}: ${inr(x.saving_per_year)}/yr potential`).join(" · ")}</div></div>
                  <ArrowRight size={16} className="text-muted mt-1" />
                </Link>
              );
            })}
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-brand">Who uses it</h2>
          <div className="mt-6 grid sm:grid-cols-2 gap-3">
            {USERS.map((u) => <div key={u.title} className="card p-4"><u.icon size={18} className="text-brand" /><div className="font-medium mt-2">{u.title}</div><p className="text-sm text-muted mt-1">{u.text}</p></div>)}
          </div>
        </div>
      </section>

      <section className="bg-brand">
        <div className="mx-auto max-w-[1200px] px-5 py-12 flex flex-wrap items-center justify-between gap-6">
          <div><h2 className="text-2xl font-semibold text-white">See it end to end in five minutes</h2><p className="text-white/70 mt-1">A cement plant replaces virgin gypsum: discovery, qualification, landed cost, trial, delivery and verified impact.</p></div>
          <div className="flex gap-3"><button onClick={() => { demo.setStep(0); demo.setActive(true); }} className="btn h-11 px-5 bg-white text-brand hover:bg-white/90"><PlayCircle size={16} /> Start the guided demo</button>
            <Link to="/dashboard" className="btn h-11 px-5 text-white border border-white/25 hover:bg-white/10">Explore the platform</Link></div>
        </div>
      </section>
    </main>
  );
}
