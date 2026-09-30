import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, ChevronDown, ClipboardList, Plus, Search, ShieldAlert, Trash2, XCircle } from "lucide-react";
import AppHeader, { AppPage } from "../components/layout/AppHeader";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { TrustBadge } from "../components/cards/Badges";
import ExchangeModal from "../components/cards/ExchangeModal";
import { ReadinessPanel, WhyPanel } from "../components/assess/ReadinessPanel";
import PropertyTable from "../components/assess/PropertyTable";
import RoutesPanel from "../components/assess/RoutesPanel";
import { api, apiError, discoverAlternatives, useClusters, useApiMutation } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { inr, num } from "../lib/format";
import { metaFor } from "../lib/industryMeta";
import type { AltStream, Alternative, DiscoverResult } from "../types";

const PROPS: [string, string][] = [["CaO", "CaO %"], ["SiO2", "SiO2 %"], ["Fe2O3", "Fe2O3 %"], ["moisture", "Moisture %"], ["purity_pct", "Purity %"],
  ["calorific_value_MJkg", "Calorific value MJ/kg"], ["organic_pct", "Organic %"], ["acid_pct", "Acid %"], ["temperature_C", "Temperature °C"]];
const EXAMPLES = [
  { intended_use: "cement production", current_material: "Virgin gypsum", monthly_tonnes: 500 },
  { intended_use: "boiler fuel for paper making", current_material: "Coal", monthly_tonnes: 800 },
  { intended_use: "process heat for food drying", current_material: "LPG heating", monthly_tonnes: 300 },
  { intended_use: "clinker substitute in cement", current_material: "Clinker", monthly_tonnes: 5000 },
];
const STATUS: Record<Alternative["status"], [string, string]> = {
  feasible: ["Feasible supply found", "bg-emerald-soft text-emerald"], not_feasible: ["Supply exists, not feasible", "bg-danger/10 text-danger"],
  no_supply: ["No supplier in range", "bg-bg text-muted"],
};

function StreamRow({ s, onInterest }: { s: AltStream; onInterest?: () => void }) {
  const [open, setOpen] = useState(false);
  const M = metaFor(s.industry.type);
  const warn = s.gates.filter((g) => g.status !== "ok");
  return (
    <div className="border-t border-border">
      <div className="px-5 py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: M.color }} />
            {s.industry.hidden ? <span className="italic">{s.industry.name}</span> : <Link to={`/industry/${s.industry.id}`} className="hover:text-brand">{s.industry.name}</Link>}
            <TrustBadge trust={s.trust} small />{s.hazardous && <ShieldAlert size={13} className="text-danger" />}
          </div>
          <div className="text-xs text-muted mt-0.5">{s.industry.hidden ? s.industry.address : s.industry.cluster} · {Math.round(s.distance_km)} km · {num(s.monthly_tonnes)} {s.unit}/month ({Math.min(100, Math.round(s.coverage * 100))}% of need)
            <span className={s.freshness.status === "fresh" ? "text-emerald" : "text-amber"}> · {s.freshness.status === "fresh" ? `confirmed ${s.freshness.days}d ago` : s.freshness.status === "stale" ? `stale (${s.freshness.days}d)` : "availability unconfirmed"}</span></div>
        </div>
        <div className="flex gap-1">{s.gates.map((g) => <span key={g.key} title={`${g.label}: ${g.text}`} className={`h-2 w-5 rounded-full ${g.status === "ok" ? "bg-emerald" : g.status === "warn" ? "bg-amber" : "bg-danger"}`} />)}</div>
        <div className="text-right w-24"><div className="text-xs text-muted">Evidence</div><div className="font-semibold tabular-nums">{Math.round(s.evidence.completeness * 100)}%</div></div>
        <div className="text-right w-28"><div className="text-xs text-muted">Landed ₹/usable t</div><div className="font-semibold tabular-nums">{s.landed_cost_per_usable_tonne != null ? inr(s.landed_cost_per_usable_tonne) : "-"}</div></div>
        <div className="text-right w-32"><div className="text-xs text-muted">Potential / yr</div><div className={`font-semibold tabular-nums ${s.viable ? "text-emerald" : "text-muted"}`}>{s.viable ? inr(s.combined_per_year_estimate) : "not viable"}</div></div>
        <div className="flex gap-2">
          <Link to={`/material/${s.waste_stream_id}`} className="btn-ghost !px-3 !py-1.5 text-xs">Passport</Link>
          {onInterest && s.viable && <button onClick={onInterest} className="btn-primary !px-3 !py-1.5 text-xs" data-demo="express-interest">Express interest</button>}
          <button onClick={() => setOpen(!open)} className="btn-ghost !px-2 !py-1.5" aria-label="Details"><ChevronDown size={14} className={open ? "rotate-180 transition" : "transition"} /></button>
        </div>
      </div>
      {!open && warn.length > 0 && s.readiness.main_blocker && <div className="px-5 pb-3 -mt-1 text-xs text-amber">⚠ {s.readiness.main_blocker.text}{s.readiness.main_blocker.action && ` → ${s.readiness.main_blocker.action}`}</div>}
      {open && (
        <div className="px-5 pb-5 grid lg:grid-cols-2 gap-6 bg-bg/40 pt-4">
          <div><h4 className="font-semibold mb-2 text-sm">Property comparison</h4><PropertyTable rows={s.properties} /><div className="mt-4"><WhyPanel why={s.why_match} concerns={s.concerns} /></div></div>
          <div><h4 className="font-semibold mb-2 text-sm">Exchange readiness</h4><ReadinessPanel a={s} compact /></div>
        </div>
      )}
    </div>
  );
}

export default function Find() {
  const clusters = useClusters();
  const auth = useAuth();
  const [form, setForm] = useState({ intended_use: "cement production", current_material: "Virgin gypsum", monthly_tonnes: 500, cluster: "Taloja MIDC", max_distance: 150, current_price: "" });
  const [spec, setSpec] = useState<{ p: string; min: string; max: string }[]>([]);
  const [res, setRes] = useState<DiscoverResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState<{ s: AltStream; material: string } | null>(null);
  const [sourcingDone, setSourcingDone] = useState<number | null>(null);
  const isCompany = !!auth.user?.industry;
  const [params] = useSearchParams();
  const sourcing = useApiMutation((b: object) => api.post<{ id: number }>("/sourcing-requests", b).then((r) => r.data), [["sourcing"]]);

  const body = (f = form) => ({
    intended_use: f.intended_use, current_material: f.current_material, monthly_tonnes: +f.monthly_tonnes, max_distance: +f.max_distance,
    current_price: f.current_price ? +f.current_price : undefined, cluster: isCompany ? undefined : f.cluster,
    required_spec: Object.fromEntries(spec.filter((r) => r.min !== "" && r.max !== "").map((r) => [r.p, [+r.min, +r.max]])),
  });
  const run = async (f = form) => {
    setBusy(true); setErr("");
    try { setRes(await discoverAlternatives(body(f))); } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); run(); };
  useEffect(() => {  // deep link / demo: /discover?use=...&current=...&qty=...&auto=1
    if (params.get("auto") !== "1" || auth.loading) return;
    const f = { ...form, intended_use: params.get("use") ?? form.intended_use, current_material: params.get("current") ?? form.current_material, monthly_tonnes: +(params.get("qty") ?? form.monthly_tonnes) };
    setForm(f); run(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, auth.loading, auth.user?.id]);
  const field = "input";
  const L = ({ t }: { t: string }) => <span className="label">{t}</span>;

  const header = (
    <AppHeader eyebrow="Source & evaluate / Discover alternatives" title="Describe what you need. Sylithex finds what can replace it."
      description="You don't need to know the by-product's name. Give the application and what you buy today; Sylithex searches listed and AI-inferred supply, checks properties, quantity, distance, processing, permits, evidence and landed cost, and explains every result.">
      <form onSubmit={submit} className="rounded-lg border border-border bg-subtle/60 p-4 space-y-3" data-demo="discover-form">
        <div className="grid md:grid-cols-[1.4fr_1.2fr_0.8fr_1fr] gap-3">
          <label><L t="Intended use" /><input className={`${field} mt-1`} value={form.intended_use} onChange={(e) => setForm({ ...form, intended_use: e.target.value })} placeholder="e.g. cement production" /></label>
          <label><L t="What you use today" /><input className={`${field} mt-1`} value={form.current_material} onChange={(e) => setForm({ ...form, current_material: e.target.value })} placeholder="e.g. virgin gypsum" /></label>
          <label><L t="Quantity (t/month)" /><input className={`${field} mt-1`} type="number" min={1} value={form.monthly_tonnes} onChange={(e) => setForm({ ...form, monthly_tonnes: +e.target.value })} /></label>
          <label><L t="Current price ₹/t (optional)" /><input className={`${field} mt-1`} type="number" min={0} value={form.current_price} onChange={(e) => setForm({ ...form, current_price: e.target.value })} placeholder="Market default" /></label>
        </div>
        <div className="grid md:grid-cols-[1fr_1fr_2fr_auto] gap-3 items-end">
          {isCompany ? <div><L t="Location" /><div className={`${field} mt-1 flex items-center bg-subtle`}>{auth.user?.industry?.name}</div></div> : (
            <label><L t="Location" /><select className={`${field} mt-1`} value={form.cluster} onChange={(e) => setForm({ ...form, cluster: e.target.value })}>{clusters.data?.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>)}
          <label><L t={`Max distance: ${form.max_distance} km`} /><input type="range" min={20} max={400} step={10} value={form.max_distance} onChange={(e) => setForm({ ...form, max_distance: +e.target.value })} className="w-full mt-3" /></label>
          <div>
            <L t="Required specification (optional)" />
            <div className="flex flex-wrap gap-2 mt-1">
              {spec.map((r, i) => (
                <div key={i} className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 h-8 text-xs text-ink">
                  <select value={r.p} onChange={(e) => setSpec(spec.map((x, j) => j === i ? { ...x, p: e.target.value } : x))} className="bg-transparent">{PROPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input className="w-12 border-b border-border" placeholder="min" value={r.min} onChange={(e) => setSpec(spec.map((x, j) => j === i ? { ...x, min: e.target.value } : x))} />–
                  <input className="w-12 border-b border-border" placeholder="max" value={r.max} onChange={(e) => setSpec(spec.map((x, j) => j === i ? { ...x, max: e.target.value } : x))} />
                  <button type="button" onClick={() => setSpec(spec.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={12} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setSpec([...spec, { p: "moisture", min: "0", max: "10" }])} className="btn-ghost !h-8 !px-2.5 text-xs"><Plus size={12} /> Add property</button>
            </div>
          </div>
          <button className="btn-primary px-6" disabled={busy}><Search size={16} /> {busy ? "Searching…" : "Discover"}</button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
        <span className="text-muted text-xs">Examples:</span>
        {EXAMPLES.map((x) => <button key={x.current_material} onClick={() => { const f = { ...form, ...x }; setForm(f); run(f); }} className="rounded-md border border-border bg-surface px-2.5 h-7 text-xs text-ink hover:bg-subtle">{x.current_material} → {x.intended_use}</button>)}
      </div>
    </AppHeader>
  );

  return (
    <AppPage header={header}>
      {err && <ErrorState error={new Error(err)} />}
      {busy && <Skeleton className="h-72" />}
      {!res && !busy && (
        <div className="grid md:grid-cols-3 gap-4">
          {[["1. Understand the application", "We map your use and current material to industrial specifications (e.g. cement → mineral gypsum: CaO 28-35%, moisture ≤18%, purity ≥85%)."],
            ["2. Search known and hidden supply", "Listed materials plus by-products inferred for every plant, matched on properties, not only names."],
            ["3. Gate every candidate", "Quantity, distance, processing, permits, evidence and economics. Rejected options come with a reason."]].map(([t, d]) => (
            <div key={t} className="card p-6"><h3 className="font-semibold">{t}</h3><p className="text-sm text-muted mt-1">{d}</p></div>))}
        </div>
      )}
      {res && !busy && (
        <div className="space-y-5">
          <div className="card p-5 flex flex-wrap gap-6 items-start">
            <div className="min-w-[240px] flex-1">
              <div className="label">We understood</div>
              <p className="mt-1"><b>{res.applications[0].raw_material}</b> for <b>{res.applications[0].use}</b>, near {res.location.label}.</p>
              <div className="flex flex-wrap gap-2 mt-2 text-xs">
                {Object.entries(res.spec).map(([k, [a, b]]) => <span key={k} className="chip bg-bg border border-border">{res.spec_labels[k]} {a}-{b}</span>)}
                <span className="chip bg-bg border border-border">Virgin price {inr(res.virgin_price)}/t · {res.price_source}</span>
              </div>
            </div>
            <ol className="flex flex-wrap gap-1 text-[10px] text-muted max-w-xl">{res.pipeline.map((p, i) => <li key={p} className="rounded bg-bg px-1.5 py-0.5">{i + 1}. {p}</li>)}</ol>
          </div>
          {res.supply_plan && (
            <div className="card p-5" data-demo="supply-plan">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="section-title">Covering your demand</div><p className="section-sub">Cheapest qualified sources first; no supplier is allocated more than its stated capacity.</p></div>
                <div className="text-right"><div className="text-2xl font-semibold tabular-nums">{res.supply_plan.coverage_pct ?? 0}%</div><div className="text-xs text-muted">{res.supply_plan.uncovered ? `${num(res.supply_plan.uncovered)} t/month uncovered` : "fully covered"}</div></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">{res.supply_plan.plan.map((p) => <span key={p.id} className="chip bg-subtle border border-border !text-xs !py-1">{p.industry?.name}: {num(p.tonnes)} t{!p.qualified && <span className="text-amber"> · needs qualification</span>}</span>)}</div>
              {res.supply_plan.single_source_risk && <p className="text-xs text-amber mt-2">Single-source risk: only one qualified supplier. Keep a backup in qualification.</p>}
            </div>
          )}
          {res.alternatives.map((a) => (
            <section key={a.material} className="card overflow-hidden" data-demo={a.material === "Phosphogypsum" ? "alt-phosphogypsum" : undefined}>
              <div className="p-5 flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-semibold">{a.material}</h2>
                    <span className={`chip ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span>
                    {a.hazardous && <span className="chip bg-danger/10 text-danger"><ShieldAlert size={11} /> Hazardous</span>}
                  </div>
                  <p className="text-sm text-muted mt-2 max-w-3xl">{a.explanation}</p>
                  {a.why_not.length > 0 && <div className="mt-2 text-xs text-danger space-y-0.5">{a.why_not.slice(0, 3).map((w) => <div key={w} className="flex gap-1"><XCircle size={12} className="mt-0.5" />{w.replace(/^✗ /, "")}</div>)}</div>}
                </div>
                <div className="text-right"><div className="text-xs text-muted">{a.feasible_count} of {a.total_count} suppliers feasible</div>
                  {a.best_value_per_year > 0 && <div className="font-display text-2xl text-emerald font-semibold">{inr(a.best_value_per_year)}<span className="text-xs text-muted font-normal">/yr best</span></div>}</div>
              </div>
              {a.streams.map((s) => <StreamRow key={s.waste_stream_id} s={s} onInterest={s.match_id ? () => setInterest({ s, material: a.material }) : undefined} />)}
            </section>
          ))}
          {res.routes?.length > 0 && (
            <section className="card p-5"><div className="section-title">Missing links: sources that work after processing</div>
              <p className="section-sub mb-4">Routes through a processing facility, with yield, capacity, both transport legs and what still needs checking.</p>
              <RoutesPanel routes={res.routes} /></section>
          )}
          <div className="card p-5 flex flex-wrap items-center gap-4">
            <ClipboardList className="text-brand" />
            <div className="flex-1 min-w-[240px]"><div className="font-semibold">Nothing suitable, or need more supply?</div>
              <p className="text-sm text-muted">Create a sourcing request. We show inferred plants as <i>potential suppliers, not yet confirmed</i>, and ask them to confirm availability.</p></div>
            {isCompany ? (sourcingDone ? <Link to="/my?tab=sourcing" className="btn-primary">View sourcing request <ArrowRight size={14} /></Link> :
              <button className="btn-primary" disabled={sourcing.isPending} onClick={() => sourcing.mutate({ material: form.current_material || res.raw_material, intended_use: form.intended_use, monthly_tonnes: +form.monthly_tonnes, radius_km: +form.max_distance, spec: res.spec, target_price: form.current_price ? +form.current_price : undefined }, { onSuccess: (r) => setSourcingDone((r as { id: number }).id) })}>Create sourcing request</button>)
              : <Link to="/login" className="btn-ghost">Log in as a company to create one</Link>}
          </div>
        </div>
      )}
      {interest && interest.s.match_id && (
        <ExchangeModal matchId={interest.s.match_id} selling={false} counterparty={interest.s.industry.name} material={`${interest.material} → ${res?.raw_material}`} unit={interest.s.unit}
          suggestedTonnes={Math.min(interest.s.monthly_tonnes, form.monthly_tonnes)} hazardous={interest.s.hazardous} onClose={() => setInterest(null)} />
      )}
    </AppPage>
  );
}
