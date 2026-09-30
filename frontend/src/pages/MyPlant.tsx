import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowRight, BrainCircuit, Clock, Eye, EyeOff, Inbox, Lock, MapPin, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import AppHeader, { AppPage, Segmented, StatStrip } from "../components/layout/AppHeader";
import ExchangeModal from "../components/cards/ExchangeModal";
import ScorePill from "../components/cards/ScorePill";
import { TrustBadge } from "../components/cards/Badges";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { api, apiError, useApiMutation, useExchanges, useIndustry, useSourcingCandidates, useSourcingLeads, useSourcingRequests } from "../api/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { CATEGORY_COLOR, inr, num, unitFor } from "../lib/format";
import { metaFor } from "../lib/industryMeta";
import type { EvidenceDoc, Exchange, Match, User } from "../types";

type Tab = "sell" | "buy" | "exchanges" | "sourcing";
const STAGE_NAME: Record<string, string> = { interest: "Interest", evidence: "Evidence", assessment: "Assessment", sample: "Sample", trial: "Trial", negotiation: "Negotiation",
  agreement: "Agreement", dispatch: "Dispatch", receipt: "Receipt", acceptance: "Acceptance", completed: "Completed" };

export function ExchangeRow({ x }: { x: Exchange }) {
  const i = x.stages.indexOf(x.stage);
  const pct = x.status === "completed" ? 100 : Math.round((i / (x.stages.length - 1)) * 100);
  return (
    <Link to={`/exchange/${x.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-bg/70 transition-colors">
      <div className="min-w-[220px] flex-1">
        <div className="text-xs text-muted">#{x.id} · {x.direction === "incoming" ? "received" : "sent"} · you are the {x.role}</div>
        <div className="font-medium">{x.match.waste_name} → {x.match.material}</div>
        <div className="text-sm text-muted flex items-center gap-1">{x.counterparty.hidden && <Lock size={12} />}{x.counterparty.name}</div>
      </div>
      <div className="w-56">
        <div className="flex justify-between text-xs"><span className="font-medium">{x.status === "declined" || x.status === "closed" ? x.status : STAGE_NAME[x.stage]}</span><span className="text-muted">{pct}%</span></div>
        <div className="h-1.5 bg-border rounded-full mt-1 overflow-hidden"><div className={`h-full rounded-full ${x.status === "completed" ? "bg-emerald" : x.status === "declined" || x.status === "closed" ? "bg-danger/50" : "bg-brand"}`} style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="w-36 text-right">{x.next.waiting_on === "you" || x.next.waiting_on === "either party" ? <span className="chip bg-amber text-white">Action needed</span>
        : x.status === "completed" ? <span className="chip bg-emerald-soft text-emerald"><ShieldCheck size={11} /> Completed</span>
        : x.next.waiting_on ? <span className="chip bg-bg text-muted"><Clock size={11} /> Waiting</span> : null}</div>
      <div className="w-28 text-right text-sm font-semibold text-emerald tabular-nums">{inr(x.match.net_saving_per_year)}<div className="text-[10px] text-muted font-normal">est. / yr</div></div>
      <ArrowRight size={16} className="text-muted" />
    </Link>
  );
}

function SourcingTab({ user }: { user: User }) {
  const reqs = useSourcingRequests(true);
  const leads = useSourcingLeads(true);
  const [sel, setSel] = useState<number | null>(null);
  const cand = useSourcingCandidates(sel);
  const invite = useApiMutation(({ rid, sid }: { rid: number; sid: number }) => api.post(`/sourcing-requests/${rid}/invite`, { waste_stream_id: sid }), [["sourcing", sel]]);
  const [conf, setConf] = useState<Record<number, string>>({});
  const respond = useApiMutation(({ id, available, t }: { id: number; available: boolean; t?: number }) => api.post(`/sourcing-leads/${id}/respond`, { available, monthly_tonnes: t }), [["leads"], ["industry"]]);
  return (
    <div className="grid xl:grid-cols-2 gap-5 mt-5">
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><div><h2 className="font-semibold">Your sourcing requests</h2><p className="text-xs text-muted">Materials you need but haven't found a listed supplier for.</p></div>
          <Link to="/discover" className="btn-ghost !py-1.5 text-xs">New via Discover</Link></div>
        {reqs.data?.length ? reqs.data.map((r) => (
          <div key={r.id} className="border-b border-border last:border-0">
            <button onClick={() => setSel(sel === r.id ? null : r.id)} className="w-full text-left px-5 py-3 hover:bg-bg/60">
              <div className="font-medium">{r.material} for {r.intended_use}</div>
              <div className="text-xs text-muted">{num(r.monthly_tonnes)} t/month · within {r.radius_km} km · {r.urgency} urgency · {r.status}</div>
            </button>
            {sel === r.id && (cand.isLoading ? <div className="px-5 pb-4"><Skeleton className="h-24" /></div> : cand.data && (
              <div className="px-5 pb-4 space-y-3 text-sm">
                <div><div className="label mb-1">Confirmed suppliers ({cand.data.confirmed.length})</div>
                  {cand.data.confirmed.slice(0, 5).map((c) => <div key={c.waste_stream_id} className="flex items-center justify-between py-1"><span>{c.industry.name} · {c.material} · {Math.round(c.distance_km)} km <TrustBadge trust={c.trust} small /></span>
                    {c.match_id ? <Link className="text-brand text-xs underline" to={`/match/${c.match_id}`}>Open match</Link> : null}</div>)}
                  {!cand.data.confirmed.length && <p className="text-muted text-xs">None yet.</p>}</div>
                <div><div className="label mb-1">Potential suppliers: not yet confirmed ({cand.data.potential.length})</div>
                  {cand.data.potential.slice(0, 6).map((c) => <div key={c.waste_stream_id} className="flex items-center justify-between py-1 gap-2"><span>{c.industry.name} · {c.material} · ~{num(c.monthly_tonnes)} t/mo est. <TrustBadge trust="ai_inferred" small /></span>
                    {c.lead ? <span className="chip bg-bg text-muted">{c.lead.status}</span> : <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => invite.mutate({ rid: r.id, sid: c.waste_stream_id })}>Ask to confirm</button>}</div>)}
                  <p className="text-[11px] text-muted mt-1">{cand.data.note}</p></div>
              </div>))}
          </div>)) : <p className="px-5 py-4 text-sm text-muted">No requests yet. Run a search in Discover and click “Create sourcing request”.</p>}
      </section>
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Requests for your materials</h2><p className="text-xs text-muted">Buyers asking whether you can supply something Sylithex inferred you generate.</p></div>
        {leads.data?.length ? leads.data.map((l) => (
          <div key={l.id} className="px-5 py-3 border-b border-border last:border-0 text-sm">
            <div className="flex items-center justify-between gap-2"><div className="font-medium">{l.material} <TrustBadge trust={l.trust} small /></div><span className="chip bg-bg text-muted">{l.status}</span></div>
            <div className="text-xs text-muted">{l.buyer.name} needs {num(l.request.monthly_tonnes)} t/month for {l.request.intended_use}. Our estimate: ~{num(l.estimated_tonnes)} t/month (not confirmed).</div>
            {l.status === "invited" && <div className="flex gap-2 mt-2"><input className="input !w-40 !py-1.5" type="number" placeholder="Confirmed t/month" value={conf[l.id] ?? ""} onChange={(e) => setConf({ ...conf, [l.id]: e.target.value })} />
              <button className="btn-green !py-1.5" disabled={!conf[l.id]} onClick={() => respond.mutate({ id: l.id, available: true, t: +conf[l.id] })}>Confirm availability</button>
              <button className="btn-ghost !py-1.5" onClick={() => respond.mutate({ id: l.id, available: false })}>Not available</button></div>}
          </div>)) : <p className="px-5 py-4 text-sm text-muted">No requests for your materials yet.</p>}
        {respond.isError && <p className="px-5 pb-3 text-xs text-danger">{apiError(respond.error)}</p>}
        <p className="px-5 py-3 text-[11px] text-muted border-t border-border">Signed in as {user.contact_name}.</p>
      </section>
    </div>
  );
}

function FacilitatorConsole({ user }: { user: User }) {
  const q = useQuery({ queryKey: ["pending-evidence"], queryFn: () => api.get<(EvidenceDoc & { material: string; company: string; waste_stream_id: number })[]>("/evidence/pending").then((r) => r.data) });
  return (
    <AppPage header={<AppHeader eyebrow="Facilitator console" title={user.contact_name} description="MIDC Symbiosis Cell: verify evidence, follow up sourcing leads and help exchanges move forward. Facilitators can see confidential identities." />}>
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-semibold">Evidence awaiting verification ({q.data?.length ?? 0})</h2></div>
        {q.data?.map((e) => <Link key={e.id} to={`/material/${e.waste_stream_id}`} className="flex justify-between px-5 py-3 border-b border-border hover:bg-bg/60 text-sm">
          <span><b>{e.title}</b><span className="block text-xs text-muted">{e.company} · {e.material}</span></span><span className="text-brand">Review <ArrowRight size={13} className="inline" /></span></Link>)}
        {!q.data?.length && <p className="px-5 py-4 text-sm text-muted">Nothing pending.</p>}
      </section>
    </AppPage>
  );
}

export default function MyPlant() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "sell";
  const id = auth.user?.industry?.id;
  const q = useIndustry(id ? String(id) : undefined);
  const ex = useExchanges(!!auth.user?.industry);
  const [modal, setModal] = useState<{ m: Match; selling: boolean } | null>(null);
  const vis = useApiMutation((v: string) => api.patch<User>("/auth/me/visibility", { visibility: v }).then((r) => r.data), [["industry"], ["industries"]]);

  if (!auth.loading && !auth.user) return <Navigate to="/login" replace />;
  if (auth.user?.role === "facilitator") return <FacilitatorConsole user={auth.user} />;
  if (!auth.user || q.isLoading) return <AppPage header={<AppHeader eyebrow="My plant" title="…" description="" />}><Skeleton className="h-96" /></AppPage>;
  if (q.error || !q.data) return <AppPage header={<AppHeader eyebrow="My plant" title="Error" description="" />}><ErrorState error={q.error} onRetry={() => q.refetch()} /></AppPage>;

  const d = q.data;
  const u = auth.user;
  const visibility = (vis.data as User | undefined)?.industry?.visibility ?? u.industry?.visibility ?? "public";
  const all = [...(ex.data?.incoming ?? []), ...(ex.data?.outgoing ?? [])].sort((a, b) => b.id - a.id);
  const openOn = new Set(all.filter((x) => ["pending", "accepted"].includes(x.status)).map((x) => x.match.id));
  const waiting = ex.data?.pending_incoming ?? 0;
  const M = metaFor(d.type);

  const Row = ({ m, selling }: { m: Match; selling: boolean }) => {
    const other = selling ? m.buyer : m.source;
    return (
      <div className="flex items-center gap-3 py-2.5">
        <Link to={`/match/${m.id}`} className="flex-1 min-w-0 hover:text-brand">
          <div className="text-sm font-medium truncate flex items-center gap-1">{other.hidden && <Lock size={12} />}{other.name}</div>
          <div className="text-xs text-muted truncate">{selling ? `replaces ${m.material}` : `${m.waste_name}`} · {Math.round(m.distance_km)} km · {inr(m.net_saving_per_year)}/yr est.</div>
        </Link>
        <ScorePill score={m.score} />
        {openOn.has(m.id) ? <span className="chip bg-bg text-muted"><Clock size={11} /> In progress</span>
          : <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setModal({ m, selling })}><Send size={12} /> {selling ? "Offer" : "Request"}</button>}
      </div>
    );
  };

  const header = (
    <AppHeader eyebrow="My plant" title={d.name}
      description={<span className="flex flex-wrap items-center gap-x-3"><span className="flex items-center gap-1"><MapPin size={13} />{d.address ?? d.cluster}</span><span>{M.label} · {num(d.capacity)} {d.capacity_unit}</span><span>{u.contact_name}, {u.designation}</span></span>}
      right={<div className="text-right">
        <Segmented value={visibility} onChange={(v) => vis.mutate(v)} options={[{ value: "public", label: "Public" }, { value: "confidential", label: "Confidential" }]} />
        <p className="text-[11px] text-muted mt-1.5 max-w-[260px] flex items-center gap-1 justify-end">{visibility === "confidential" ? <><EyeOff size={11} /> Name & exact site hidden until mutual consent</> : <><Eye size={11} /> Visible to all plants</>}</p>
      </div>}>
      <StatStrip stats={[
        { label: "Earn from by-products / yr", value: d.totals.outgoing_saving, format: (n) => inr(n), sub: "estimate" },
        { label: "Save on inputs / yr", value: d.totals.incoming_saving, format: (n) => inr(n), sub: "estimate" },
        { label: "AI-inferred streams", value: d.totals.hidden_streams, format: (n) => `${Math.round(n)}`, sub: "need your confirmation" },
        { label: "Open exchanges", value: all.filter((x) => ["pending", "accepted"].includes(x.status)).length, format: (n) => `${Math.round(n)}` },
        { label: "Waiting on you", value: waiting, format: (n) => `${Math.round(n)}` },
        { label: "Completed", value: all.filter((x) => x.status === "completed").length, format: (n) => `${Math.round(n)}` },
      ]} />
    </AppHeader>
  );

  const TABS: [Tab, string, number?][] = [["sell", "Sell by-products"], ["buy", "Buy cheaper inputs"], ["exchanges", "Exchanges", waiting], ["sourcing", "Sourcing"]];
  return (
    <AppPage header={header}>
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(([k, label, badge]) => (
          <button key={k} onClick={() => setParams({ tab: k })} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex items-center gap-2 ${tab === k ? "border-emerald text-brand" : "border-transparent text-muted hover:text-ink"}`}>
            {label}{!!badge && <span className="chip bg-amber text-white">{badge}</span>}</button>))}
      </div>

      {tab === "sell" && (
        <div className="grid xl:grid-cols-2 gap-5 mt-5" data-demo="my-sell">
          {d.waste_streams.map((s) => (
            <div key={s.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[s.category] }} />
                <h3 className="font-semibold">{s.waste_name}</h3>
                <span className="text-sm text-muted">{num(s.monthly_tonnes)} {unitFor(s.category)}/month</span>
                <TrustBadge trust={s.trust} />{s.hazardous && <span className="chip bg-danger/10 text-danger"><ShieldAlert size={11} /> Hazardous</span>}
                <Link to={`/material/${s.id}`} className="ml-auto text-xs text-brand font-medium">Passport & evidence →</Link>
              </div>
              {s.trust === "ai_inferred" && <p className="text-xs text-amber mt-2 flex gap-1"><BrainCircuit size={13} className="shrink-0 mt-0.5" />Estimated by Sylithex ({Math.round(s.confidence * 100)}% confidence). Confirm it on the passport so buyers can trust it.</p>}
              <div className="mt-2 divide-y divide-border">{s.top_matches.length ? s.top_matches.map((m) => <Row key={m.id} m={m} selling />) : <p className="text-sm text-muted py-2">No viable buyer within range yet.</p>}</div>
            </div>))}
        </div>
      )}
      {tab === "buy" && (
        <div className="grid xl:grid-cols-2 gap-5 mt-5">
          {d.demands.map((dm) => (
            <div key={dm.id} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">{dm.material}</h3><span className="text-sm text-muted">~{num(dm.monthly_tonnes)}/month · {inr(dm.virgin_price)}/unit virgin</span></div>
              <Link to={`/photos?mode=requirement&demand=${dm.id}`} className="btn-link text-xs">Match by photo →</Link>
              <div className="mt-2 divide-y divide-border">{dm.top_suppliers.length ? dm.top_suppliers.map((m) => <Row key={m.id} m={m} selling={false} />) : <p className="text-sm text-muted py-2">No waste-based supplier nearby. <Link to="/discover" className="text-brand">Discover alternatives</Link></p>}</div>
            </div>))}
        </div>
      )}
      {tab === "exchanges" && (
        <section className="card mt-5 overflow-hidden divide-y divide-border" data-demo="my-exchanges">
          {ex.isLoading ? <div className="p-5"><Skeleton className="h-40" /></div> : all.length ? all.map((x) => <ExchangeRow key={x.id} x={x} />)
            : <div className="p-6 text-sm text-muted flex items-center gap-2"><Inbox size={16} /> No exchanges yet. Send an offer from “Sell by-products” or a request from “Buy cheaper inputs”.</div>}
        </section>
      )}
      {tab === "sourcing" && <SourcingTab user={u} />}
      {modal && <ExchangeModal matchId={modal.m.id} selling={modal.selling} counterparty={modal.selling ? modal.m.buyer.name : modal.m.source.name}
        material={`${modal.m.waste_name} → ${modal.m.material}`} unit={unitFor(modal.m.category)} suggestedTonnes={modal.m.tradable_tonnes} hazardous={modal.m.hazardous} onClose={() => setModal(null)} />}
    </AppPage>
  );
}
