import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, FileText, Lock, Send, ShieldAlert, Truck } from "lucide-react";
import AppHeader, { AppPage, Tabs } from "../components/layout/AppHeader";
import ClusterMap from "../components/map/ClusterMap";
import SeasonalityChart from "../components/charts/SeasonalityChart";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { TrustBadge } from "../components/cards/Badges";
import ExchangeModal from "../components/cards/ExchangeModal";
import { ReadinessPanel, WhyPanel } from "../components/assess/ReadinessPanel";
import PropertyTable from "../components/assess/PropertyTable";
import TwoSidedEconomics from "../components/assess/TwoSidedEconomics";
import { EligibilityBanner, EvidenceStates, FactorTable } from "../components/assess/QualificationPanel";
import LandedCostCalculator from "../components/assess/LandedCostCalculator";
import SupplyPanel from "../components/assess/SupplyPanel";
import BackupFinder from "../components/assess/BackupFinder";
import RoutesPanel from "../components/assess/RoutesPanel";
import { useMatch, useMatchAssessment, useRoutes } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { inr, num, unitFor } from "../lib/format";

type Tab = "overview" | "qualify" | "cost" | "supply" | "routes" | "economics";
const SCORE: [string, string][] = [["technical", "Technical fit"], ["economic", "Economic fit"], ["distance", "Distance fit"], ["environmental", "Environmental fit"], ["evidence", "Evidence completeness"]];

export default function MatchDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "overview";
  const q = useMatch(id);
  const a = useMatchAssessment(id);
  const routes = useRoutes(tab === "routes" ? id : undefined);
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const m = q.data;
  const A = a.data;

  const header = (
    <AppHeader eyebrow="Matches / analysis" title={m ? <>{m.waste_name} <span className="text-muted font-normal">→</span> {m.material}</> : "Loading…"}
      description={m ? <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {m.source.hidden ? <span className="inline-flex items-center gap-1"><Lock size={13} />{m.source.name}</span> : <Link to={`/industry/${m.source.id}`} className="text-brand hover:underline">{m.source.name}</Link>}
        <span>supplies</span>
        {m.buyer.hidden ? <span className="inline-flex items-center gap-1"><Lock size={13} />{m.buyer.name}</span> : <Link to={`/industry/${m.buyer.id}`} className="text-brand hover:underline">{m.buyer.name}</Link>}
        <span>· {Math.round(m.distance_km)} km</span>{A && <TrustBadge trust={A.trust} />}</span> : ""}
      right={A && <>
        <Link to={`/material/${A.waste_stream_id}`} className="btn-ghost"><FileText size={15} /> Material passport</Link>
        {A.exchange ? <Link to={`/exchange/${A.exchange.id}`} className="btn-primary">Open exchange #{A.exchange.id} <ArrowRight size={15} /></Link>
          : A.viewer_role ? <button className="btn-primary" data-demo="contact" onClick={() => setOpen(true)}><Send size={15} /> {A.viewer_role === "supplier" ? "Send offer" : "Express interest"}</button>
          : !auth.user ? <Link to="/login" className="btn-ghost">Log in as one of these plants to act</Link> : null}
      </>}>
      {A && <div className="grid grid-cols-2 md:grid-cols-6 rounded-lg border border-border divide-x divide-border overflow-hidden bg-surface">
        <div className="px-4 py-3"><div className="text-[11.5px] text-muted">Ranking score</div><div className="text-[20px] font-semibold tabular-nums">{Math.round(A.overall_score)}</div></div>
        {SCORE.map(([k, l]) => { const v = Math.round((A.scores[k] ?? 0) * 100); return (
          <div key={k} className="px-4 py-3"><div className="text-[11.5px] text-muted">{l}</div>
            <div className={`text-[20px] font-semibold tabular-nums ${k === "evidence" && v < 100 ? "text-amber" : ""}`}>{v}%</div></div>); })}
      </div>}
    </AppHeader>
  );
  if (q.error) return <AppPage header={header}><ErrorState error={q.error} onRetry={() => q.refetch()} /></AppPage>;
  if (!m || !A) return <AppPage header={header}><Skeleton className="h-96" /></AppPage>;
  const unit = unitFor(m.category);

  return (
    <AppPage header={header}>
      <div className="mb-5"><EligibilityBanner e={A.eligibility} /></div>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { value: "overview", label: "Overview" }, { value: "qualify", label: "Qualification" }, { value: "cost", label: "True landed cost" },
        { value: "supply", label: "Supply & backups" }, { value: "routes", label: "Processing routes" }, { value: "economics", label: "Buyer & supplier economics" }]} />
      <div className="mt-5">
        {tab === "overview" && (
          <div className="grid xl:grid-cols-[1fr_360px] gap-5">
            <div className="space-y-5 min-w-0">
              <section className="card p-5" data-demo="readiness"><div className="section-title mb-3">Exchange readiness</div><ReadinessPanel a={A} /></section>
              <section className="card p-5"><WhyPanel why={A.why_match} concerns={A.concerns} /></section>
              <section className="card p-5"><div className="section-title mb-2">Specification check</div><PropertyTable rows={A.properties} /></section>
            </div>
            <aside className="space-y-5">
              <section className="card p-3">
                {m.source.lat != null && m.buyer.lat != null ? <ClusterMap className="h-[220px]" nodes={[m.source, m.buyer]} links={[{ key: m.id, from: m.source, to: m.buyer, score: m.score, tonnes: 1, label: `${Math.round(m.distance_km)} km` }]} />
                  : <div className="h-[100px] flex items-center justify-center text-sm text-muted"><Lock size={14} className="mr-1" /> Exact location hidden (confidential)</div>}
                <div className="flex items-center gap-2 text-xs text-muted mt-2 px-1"><Truck size={13} /> {Math.round(m.distance_km)} km by road</div>
              </section>
              <section className="card p-5">
                <div className="section-title">Summary</div>
                <p className="mt-2 text-sm leading-relaxed text-ink/85">{m.explanation}</p>
                <p className="text-[11px] text-muted mt-2">{m.explanation_source === "llm" ? "Written by an AI model from the figures above" : "Generated from the figures above"}</p>
              </section>
              <section className="card p-5">
                <div className="section-title">At a glance</div>
                <div className="mt-2">
                  <div className="kv"><span>Tradable</span><span className="tabular-nums">{num(m.tradable_tonnes)} {unit}/month</span></div>
                  <div className="kv"><span>Potential value</span><span className="tabular-nums">{inr(m.net_saving_per_year)}/yr (estimate)</span></div>
                  <div className="kv"><span>Landed cost / usable {unit}</span><span className="tabular-nums">{A.landed_cost.cost_per_usable_tonne != null ? inr(A.landed_cost.cost_per_usable_tonne) : "-"}</span></div>
                  <div className="kv"><span>CO2 avoided</span><span className="tabular-nums">{num(m.co2_saved_per_year)} t/yr (estimate)</span></div>
                  <div className="kv"><span>Processing</span><span className="text-right">{m.processing_steps.map((s) => s.step).join(", ") || "None"}</span></div>
                </div>
                {m.regulatory_flags.length > 0 && <div className="mt-3 text-xs"><div className="font-medium text-danger flex items-center gap-1"><ShieldAlert size={13} /> Permissions required</div>
                  <ul className="list-disc pl-4 mt-1 text-muted space-y-0.5">{m.regulatory_flags.map((f) => <li key={f}>{f}</li>)}</ul></div>}
              </section>
              <section className="card p-5"><div className="section-title">Seasonality</div><p className="section-sub mb-2">Timing fit {Math.round(m.timing_score * 100)}%</p><SeasonalityChart {...m.seasonality} unit={unit} /></section>
            </aside>
          </div>
        )}
        {tab === "qualify" && (
          <div className="grid xl:grid-cols-2 gap-5">
            <section className="card p-5"><div className="section-title mb-1">Material qualification</div><p className="section-sub mb-3">PASS, FAIL or UNKNOWN for every required property. Unknown never counts as a pass.</p>
              <PropertyTable rows={A.properties} /><div className="mt-5"><EvidenceStates docs={A.evidence_documents} latest={A.latest_test_date} /></div></section>
            <section className="card p-5"><div className="section-title mb-1">How the ranking score is built</div><p className="section-sub mb-3">Each factor, its weight and its contribution. A critical failure blocks eligibility whatever the score.</p>
              <FactorTable f={A.factors} /></section>
          </div>
        )}
        {tab === "cost" && <section className="card p-5"><div className="section-title mb-1">True landed cost</div><p className="section-sub mb-4">Cost per usable tonne after freight, handling, storage, processing, testing and rejected loads, compared with the conventional material on the same basis.</p>
          <LandedCostCalculator matchId={m.id} initial={A.landed_cost} /></section>}
        {tab === "supply" && <div className="space-y-5">
          <section className="card p-5"><div className="section-title mb-3">Supply assurance</div><SupplyPanel s={A.supply} /></section>
          <section className="card p-5"><div className="section-title mb-1">Backup finder</div><p className="section-sub mb-3">Other sources for the same requirement, compared on quality, coverage, landed cost, distance, timing and CO2.</p><BackupFinder matchId={m.id} /></section>
        </div>}
        {tab === "routes" && <section className="card p-5"><div className="section-title mb-1">Missing links: processing routes</div>
          <p className="section-sub mb-4">Sources that do not meet the specification directly but could after a processor, with yield, capacity, both transport legs and unresolved checks.</p>
          {routes.isLoading || !routes.data ? <Skeleton className="h-48" /> : <RoutesPanel routes={routes.data.routes} note={routes.data.note} />}</section>}
        {tab === "economics" && <section className="card p-5"><div className="section-title mb-3">Economics for each party (per {unit})</div><TwoSidedEconomics e={A.economics} /></section>}
      </div>
      {open && <ExchangeModal matchId={m.id} selling={A.viewer_role === "supplier"} counterparty={A.viewer_role === "supplier" ? m.buyer.name : m.source.name}
        material={`${m.waste_name} → ${m.material}`} unit={unit} suggestedTonnes={m.tradable_tonnes} hazardous={m.hazardous} onClose={() => setOpen(false)} />}
    </AppPage>
  );
}
