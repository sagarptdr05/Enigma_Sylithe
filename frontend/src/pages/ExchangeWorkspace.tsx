import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Clock, FileText, LifeBuoy, Lock, Mail, Phone, Repeat, ShieldCheck, Unlock } from "lucide-react";
import AppHeader, { AppPage, Tabs } from "../components/layout/AppHeader";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { ReadinessPanel } from "../components/assess/ReadinessPanel";
import PropertyTable from "../components/assess/PropertyTable";
import TrialChecklist from "../components/exchange/TrialChecklist";
import BatchTable from "../components/exchange/BatchTable";
import ResponsibilityMatrix from "../components/exchange/ResponsibilityMatrix";
import ImpactRecordPanel from "../components/exchange/ImpactRecordPanel";
import { api, apiError, useApiMutation, useExchange } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { inr, num, titleCase, unitFor } from "../lib/format";
import type { Exchange } from "../types";

const LABEL: Record<string, string> = { discovery: "Discovery", interest: "Interest", evidence: "Evidence", assessment: "Assessment", sample: "Sample", trial: "Trial",
  negotiation: "Negotiation", agreement: "Agreement", dispatch: "Dispatch", receipt: "Receipt", acceptance: "Acceptance", completed: "Completed" };
const STATUS: Record<Exchange["status"], [string, string]> = { pending: ["Awaiting reply", "bg-amber-soft text-amber"], accepted: ["In progress", "bg-sky-soft text-sky"],
  completed: ["Completed", "bg-emerald-soft text-emerald"], declined: ["Declined", "bg-danger-soft text-danger"], closed: ["Closed", "bg-subtle text-muted"] };
type Tab = "next" | "plan" | "deliveries" | "terms" | "impact";

function Stepper({ x }: { x: Exchange }) {
  const steps = ["discovery", ...x.stages];
  const cur = steps.indexOf(x.stage);
  return (
    <ol className="flex items-center overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = i < cur || x.status === "completed";
        const now = i === cur && x.status !== "completed";
        return (
          <li key={s} className="flex items-center shrink-0">
            <div className="flex items-center gap-1.5">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold border ${done ? "bg-emerald border-emerald text-white" : now ? "bg-brand border-brand text-white" : "border-border text-muted bg-surface"}`}>
                {done ? <Check size={12} /> : i + 1}</span>
              <span className={`text-xs ${now ? "font-semibold text-ink" : "text-muted"}`}>{LABEL[s]}</span>
            </div>
            {i < steps.length - 1 && <span className={`h-px w-5 mx-2 ${done ? "bg-emerald" : "bg-border"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function NextStep({ x, act }: { x: Exchange; act: (b: object) => void }) {
  const [text, setText] = useState("");
  const [price, setPrice] = useState(String(x.terms.offer?.price ?? x.price_per_tonne ?? ""));
  const [tonnes, setTonnes] = useState(String(x.terms.offer?.tonnes ?? x.terms.tonnes ?? x.quantities.dispatched ?? Math.round(x.monthly_tonnes)));
  const [ref, setRef] = useState("");
  const [promised, setPromised] = useState("");
  const [reveal, setReveal] = useState(true);
  const [acc, setAcc] = useState(String(x.quantities.received ?? ""));
  const [rej, setRej] = useState("0");
  const [corr, setCorr] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const u = unitFor(x.match.category);
  const mine = x.next.waiting_on === "you" || x.next.waiting_on === "either party";
  const other = x.role === "supplier" ? "buyer" : "supplier";
  const go = (action: string, extra: object = {}) => { act({ action, text: text || undefined, ...extra }); setText(""); };
  const criteria = Object.entries(x.acceptance_criteria ?? {});

  let body: React.ReactNode = null;
  if (x.status === "completed") body = <p className="text-sm">Delivery accepted. See <b>Deliveries</b> for batch records and <b>Impact</b> for the reported and verified results.</p>;
  else if (x.status === "declined" || x.status === "closed") body = <p className="text-sm text-muted">This exchange is {x.status}.</p>;
  else if (!mine) body = <p className="text-sm flex items-center gap-2"><Clock size={15} className="text-amber" /> Waiting for the {x.next.owner === "recipient" ? "other company" : x.next.owner === "both" ? other : x.next.owner}: {x.next.action.charAt(0).toLowerCase() + x.next.action.slice(1)}.</p>;
  else if (x.stage === "interest") body = <>
    <textarea className="input min-h-20" placeholder="Reply (optional)" value={text} onChange={(e) => setText(e.target.value)} />
    <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" className="accent-brand" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Reveal our identity to them</label>
    <div className="flex gap-2 mt-3"><button className="btn-green" onClick={() => go("accept", { reveal_identity: reveal })}>Accept</button><button className="btn-ghost" onClick={() => go("decline")}>Decline</button></div></>;
  else if (x.stage === "evidence") body = <>
    <p className="text-sm text-muted">{x.evidence_count} document(s) on the material passport. Upload the latest lab report, SDS and permits, then submit.</p>
    <div className="flex gap-2 mt-3"><Link to={`/material/${x.match.waste_stream_id}`} className="btn-ghost"><FileText size={14} /> Open material passport</Link>
      <button className="btn-primary" disabled={!x.evidence_count} onClick={() => go("submit_evidence")}>Submit evidence package</button></div></>;
  else if (["assessment", "sample", "trial"].includes(x.stage)) body = <>
    <textarea className="input min-h-20" placeholder={`${titleCase(x.stage)} notes, e.g. purity 91% meets specification`} value={text} onChange={(e) => setText(e.target.value)} />
    <div className="flex gap-2 mt-3"><button className="btn-green" onClick={() => go(`record_${x.stage}`, { result: "pass" })}>Passed</button><button className="btn-ghost text-danger" onClick={() => go(`record_${x.stage}`, { result: "fail" })}>Failed (close)</button></div></>;
  else if (x.stage === "negotiation") {
    const o = x.terms.offer;
    body = <>
      {o && <div className="rounded-md bg-subtle p-3 text-sm mb-3 flex flex-wrap items-center gap-3">Current offer by <b>{o.by === x.role ? "you" : `the ${o.by}`}</b>: <b>{inr(o.price)}/{u}</b> for <b>{num(o.tonnes)} {u}/month</b>
        {o.by !== x.role && <button className="btn-green !h-8" onClick={() => go("accept_offer")}>Accept offer</button>}</div>}
      <div className="grid grid-cols-2 gap-2 max-w-md"><label><span className="label">Price ₹/{u}</span><input className="input mt-1" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label><span className="label">Quantity {u}/month</span><input className="input mt-1" type="number" value={tonnes} onChange={(e) => setTonnes(e.target.value)} /></label></div>
      <button className="btn-primary mt-3" disabled={!price || !tonnes} onClick={() => go("offer", { price: +price, tonnes: +tonnes })}>{!o ? "Send offer" : o.by === x.role ? "Revise offer" : "Send counter-offer"}</button>
      <p className="text-xs text-muted mt-2">Agree responsibilities and acceptance criteria in the <b>Responsibilities</b> tab before signing.</p></>;
  } else if (x.stage === "agreement") body = <>
    <p className="text-sm">Terms: <b>{inr(x.terms.price ?? 0)}/{u}</b>, <b>{num(x.terms.tonnes ?? 0)} {u}/month</b>. Signed by: {Object.keys(x.terms.signatures).join(", ") || "nobody yet"}.</p>
    <button className="btn-primary mt-3" onClick={() => go("sign")}>Sign agreement</button></>;
  else if (x.stage === "dispatch") body = <>
    <div className="grid sm:grid-cols-3 gap-2 max-w-2xl"><label><span className="label">Quantity ({u})</span><input className="input mt-1" type="number" value={tonnes} onChange={(e) => setTonnes(e.target.value)} /></label>
      <label><span className="label">Promised delivery date</span><input className="input mt-1" type="date" value={promised} onChange={(e) => setPromised(e.target.value)} /></label>
      <label><span className="label">Manifest ref{x.match.hazardous ? " (required)" : ""}</span><input className="input mt-1" value={ref} onChange={(e) => setRef(e.target.value)} /></label></div>
    <button className="btn-primary mt-3" onClick={() => go("dispatch", { tonnes: +tonnes, reference: ref || undefined, promised_date: promised || undefined })}>Record dispatch (new batch)</button></>;
  else if (x.stage === "receipt") body = <>
    <label className="block max-w-xs"><span className="label">Received at gate ({u})</span><input className="input mt-1" type="number" value={tonnes} onChange={(e) => setTonnes(e.target.value)} /></label>
    <button className="btn-primary mt-3" onClick={() => go("receive", { tonnes: +tonnes })}>Record receipt</button></>;
  else if (x.stage === "acceptance") body = <>
    <p className="text-sm">Received {num(x.quantities.received ?? 0)} {u}. Record the batch test and how much you accept.</p>
    {criteria.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{criteria.map(([k, [lo, hi]]) => (
      <label key={k} className="text-xs border border-border rounded-md px-2 py-1 bg-surface">{k.replace("_pct", "").replace("_MJkg", "")} <span className="text-muted">({lo}-{hi})</span>
        <input className="w-16 ml-1 outline-none tabular-nums" type="number" step="any" value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></label>))}</div>}
    <div className="grid sm:grid-cols-3 gap-2 mt-3 max-w-2xl">
      <label><span className="label">Accepted ({u})</span><input className="input mt-1" type="number" value={acc} onChange={(e) => setAcc(e.target.value)} /></label>
      <label><span className="label">Rejected ({u})</span><input className="input mt-1" type="number" value={rej} onChange={(e) => setRej(e.target.value)} /></label>
      <label><span className="label">Corrective action</span><input className="input mt-1" value={corr} onChange={(e) => setCorr(e.target.value)} placeholder="If anything is rejected" /></label></div>
    <textarea className="input min-h-16 mt-2" placeholder="Inspection notes / rejection reason" value={text} onChange={(e) => setText(e.target.value)} />
    <div className="flex gap-2 mt-3">
      <button className="btn-green" onClick={() => go("accept_delivery", { accepted_tonnes: +acc, rejected_tonnes: +rej, corrective_action: corr || undefined, values: Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => [k, +v])) })}>Accept batch</button>
      <button className="btn-ghost text-danger" onClick={() => go("reject_delivery", { corrective_action: corr || undefined, values: Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => [k, +v])) })}>Reject whole batch</button></div></>;
  return (
    <section className="card p-5" data-demo="next-action">
      <div className="label">Your next step</div>
      <h2 className="text-lg font-semibold mt-0.5">{LABEL[x.stage]}: {x.next.action}</h2>
      <div className="mt-3">{body}</div>
      {["pending", "accepted"].includes(x.status) && !["agreement", "dispatch", "receipt", "acceptance"].includes(x.stage) &&
        <button className="text-xs text-muted underline mt-4" onClick={() => go("withdraw")}>Withdraw from this exchange</button>}
    </section>
  );
}

export default function ExchangeWorkspace() {
  const { id } = useParams();
  const nav = useNavigate();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "next";
  const q = useExchange(id);
  const [comment, setComment] = useState("");
  const m = useApiMutation((b: object) => api.post(`/exchanges/${id}/action`, b).then((r) => r.data), [["exchange", id], ["exchanges"], ["impact"]]);
  const repeat = useApiMutation(() => api.post<Exchange>(`/exchanges/${id}/repeat`).then((r) => r.data), [["exchanges"]]);
  const x = q.data;
  if (!auth.loading && !auth.user) return <AppPage header={<AppHeader eyebrow="Exchange" title="Log in to view this exchange" description="Exchanges are private to the two companies." />}><Link to="/login" className="btn-primary">Log in</Link></AppPage>;
  if (q.error) return <AppPage header={<AppHeader eyebrow="Exchange" title="Not found" description="This exchange does not exist or you are not part of it." />}><ErrorState error={q.error} /></AppPage>;
  if (!x) return <AppPage header={<AppHeader eyebrow="Exchange" title="Loading…" description="" />}><Skeleton className="h-96" /></AppPage>;
  const u = unitFor(x.match.category);
  const cp = x.counterparty;
  const active = ["pending", "accepted"].includes(x.status);
  const facilitator = auth.user?.role === "facilitator";
  const act = (b: object) => m.mutate(b);
  const openItems = x.checklist?.filter((i) => i.status === "open").length ?? 0;

  const header = (
    <AppHeader eyebrow={`Exchanges / #${x.id}${x.repeat_of ? ` (repeat of #${x.repeat_of})` : ""}`}
      title={<>{x.match.waste_name} <span className="text-muted font-normal">→</span> {x.match.material}</>}
      description={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">You are the <b className="text-ink">{x.role ?? "facilitator"}</b> ·
        {cp.hidden ? <span className="inline-flex items-center gap-1"><Lock size={13} /> {cp.name} ({cp.address})</span> : <span>with <Link to={`/industry/${cp.id}`} className="text-brand hover:underline">{cp.name}</Link></span>}
        · {Math.round(x.match.distance_km)} km</span>}
      right={<>
        <span className={`chip !text-xs !px-2 !py-1 ${STATUS[x.status][1]}`}>{STATUS[x.status][0]}</span>
        {active && x.role && !x.facilitation_requested && <button className="btn-ghost" onClick={() => act({ action: "request_facilitation" })}><LifeBuoy size={15} /> Ask a facilitator</button>}
        {x.facilitation_requested && <span className="chip bg-sky-soft text-sky !text-xs">Facilitator notified</span>}
        {x.status === "completed" && x.role && <button className="btn-primary" onClick={() => repeat.mutate(undefined, { onSuccess: (r) => nav(`/exchange/${(r as Exchange).id}`) })}><Repeat size={14} /> Repeat exchange</button>}
      </>}>
      <Stepper x={x} />
    </AppHeader>
  );

  return (
    <AppPage header={header}>
      {m.isError && <p className="mb-3 text-sm text-danger">{apiError(m.error)}</p>}
      <div className="grid xl:grid-cols-[1fr_360px] gap-6">
        <div className="min-w-0">
          <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: "next", label: "Next step" }, { value: "plan", label: "Qualification & trial plan", badge: openItems },
            { value: "deliveries", label: "Deliveries & batches", badge: x.batches?.length ?? 0 }, { value: "terms", label: "Responsibilities" }, { value: "impact", label: "Impact" }]} />
          <div className="mt-5 space-y-5">
            {tab === "next" && <>
              <NextStep key={`${x.stage}-${x.updated_at}`} x={x} act={act} />
              <section className="card p-5 grid md:grid-cols-2 gap-6">
                <div data-demo="consent">
                  <div className="section-title flex items-center gap-2">{x.consent.identity_revealed ? <Unlock size={15} className="text-emerald" /> : <Lock size={15} className="text-amber" />} Identity</div>
                  <div className="mt-2"><div className="kv"><span>Supplier consent</span><span>{x.consent.supplier ? "Given" : "Pending"}</span></div><div className="kv"><span>Buyer consent</span><span>{x.consent.buyer ? "Given" : "Pending"}</span></div></div>
                  <p className="text-xs text-muted mt-2">{x.consent.identity_revealed ? "Identities are revealed to both parties." : "Names, exact site and contacts stay hidden until both consent."}</p>
                  {x.role && !x.consent[x.role] && active && <button className="btn-ghost !h-8 mt-3 text-xs" onClick={() => act({ action: "consent" })}>Reveal our identity</button>}
                  {x.counterparty_contact && <div className="mt-3 rounded-md border border-border p-3 text-sm space-y-0.5">
                    <div className="font-medium">{x.counterparty_contact.name}{x.counterparty_contact.designation && `, ${x.counterparty_contact.designation}`}</div>
                    <a href={`mailto:${x.counterparty_contact.email}`} className="flex items-center gap-1 text-brand"><Mail size={13} />{x.counterparty_contact.email}</a>
                    {x.counterparty_contact.phone && <div className="flex items-center gap-1 text-muted"><Phone size={13} />{x.counterparty_contact.phone}</div>}</div>}
                </div>
                <div>
                  <div className="section-title">Terms & cost</div>
                  <div className="mt-2">
                    <div className="kv"><span>Requested</span><span className="tabular-nums">{num(x.monthly_tonnes)} {u}/month</span></div>
                    <div className="kv"><span>Agreed price</span><span className="tabular-nums">{x.terms.price != null ? `${inr(x.terms.price)}/${u}` : "-"}</span></div>
                    <div className="kv"><span>Agreed quantity</span><span className="tabular-nums">{x.terms.tonnes != null ? `${num(x.terms.tonnes)} ${u}/month` : "-"}</span></div>
                    <div className="kv"><span>Landed cost / usable {u}</span><span className="tabular-nums">{x.landed_cost?.cost_per_usable_tonne != null ? inr(x.landed_cost.cost_per_usable_tonne) : "-"}</span></div>
                    <div className="kv"><span>Conventional material</span><span className="tabular-nums">{x.landed_cost?.baseline_per_usable_tonne != null ? inr(x.landed_cost.baseline_per_usable_tonne) : "-"}</span></div>
                  </div>
                  <Link to={`/match/${x.match.id}?tab=cost`} className="btn-link text-xs inline-flex items-center gap-1 mt-2">Open landed-cost calculator <ArrowRight size={12} /></Link>
                </div>
              </section>
              {x.assessment && <section className="card p-5"><div className="section-title mb-3">Exchange readiness</div><ReadinessPanel a={x.assessment} />
                <div className="section-title mt-6 mb-2">Specification check</div><PropertyTable rows={x.assessment.properties} /></section>}
            </>}
            {tab === "plan" && x.checklist && <section className="card p-5"><TrialChecklist items={x.checklist} role={x.role} active={active} onUpdate={(item_id, status, text) => act({ action: "update_checklist", item_id, status, text })} /></section>}
            {tab === "deliveries" && <section className="card p-5"><div className="section-title mb-1">Batch records</div><p className="section-sub mb-4">Delivered, accepted and rejected quantities are kept separately for every batch, with test results against the agreed criteria.</p>
              <BatchTable batches={x.batches ?? []} unit={u} /></section>}
            {tab === "terms" && <section className="card p-5 grid lg:grid-cols-2 gap-6">
              <div><div className="section-title mb-2">Who is responsible</div><ResponsibilityMatrix value={x.responsibilities ?? {}} editable={active && !!x.role && !["dispatch", "receipt", "acceptance"].includes(x.stage)}
                onChange={(k, v) => act({ action: "set_terms", responsibilities: { [k]: v } })} /></div>
              <div><div className="section-title mb-2">Acceptance criteria</div>
                <table className="table"><thead><tr><th>Property</th><th>Accept if</th></tr></thead>
                  <tbody>{Object.entries(x.acceptance_criteria ?? {}).map(([k, [lo, hi]]) => <tr key={k}><td>{k.replace("_pct", " %").replace("_MJkg", " MJ/kg").replace("_", " ")}</td><td className="tabular-nums">{lo} – {hi}</td></tr>)}</tbody></table>
                <p className="text-[11px] text-muted mt-2">Batches are tested against these limits on receipt. Defaults come from the buyer's specification.</p></div>
            </section>}
            {tab === "impact" && x.impact_record && <section className="card p-5"><div className="section-title mb-3">Exchange impact</div>
              <ImpactRecordPanel r={x.impact_record} canVerify={facilitator && x.status === "completed" && x.impact_record.verified.status !== "verified"}
                canRecordUse={x.role === "buyer" && x.status === "completed"} onVerify={() => act({ action: "verify_impact" })} onRecordUse={(t) => act({ action: "record_use", tonnes: t })} /></section>}
          </div>
        </div>
        <aside className="card p-5 h-fit">
          <div className="section-title">Timeline</div>
          <ol className="mt-4 space-y-4 relative before:absolute before:left-[5px] before:top-1 before:bottom-1 before:w-px before:bg-border">
            {x.events?.map((e) => (
              <li key={e.id} className="pl-5 relative">
                <span className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-surface ${e.kind === "comment" ? "bg-sky" : e.kind === "blocker" ? "bg-danger" : e.kind === "offer" ? "bg-amber" : "bg-emerald"}`} />
                <div className="text-[11px] text-muted">{LABEL[e.stage] ?? e.stage} · {e.actor} · {new Date(e.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                <div className="text-[13px]">{e.text}</div>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex gap-2">
            <input className="input" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn-primary" disabled={!comment} onClick={() => m.mutate({ action: "comment", text: comment }, { onSuccess: () => setComment("") })}>Post</button>
          </div>
          {x.impact?.verified && <p className="text-xs text-emerald mt-4 flex items-center gap-1"><ShieldCheck size={13} /> Impact independently verified</p>}
        </aside>
      </div>
    </AppPage>
  );
}
