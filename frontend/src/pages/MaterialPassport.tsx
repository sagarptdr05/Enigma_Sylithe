import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { FileText, Lock, MapPin, Paperclip, Route, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import AppHeader, { AppPage } from "../components/layout/AppHeader";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import SupplyPanel from "../components/assess/SupplyPanel";
import { BasisTag, RequiresEvidence, SourceTag, TrustBadge } from "../components/cards/Badges";
import ScorePill from "../components/cards/ScorePill";
import { api, apiError, deletePhoto, extractDocument, useApiMutation, usePassport, usePathways, useSupplyPhotos } from "../api/client";
import { PhotoCard, PhotoUploader } from "../components/photos/Photo";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { inr, num, titleCase } from "../lib/format";
import { metaFor } from "../lib/industryMeta";

const EV_TYPES = [["lab_report", "Lab report"], ["spec_sheet", "Specification sheet"], ["sds", "Safety data sheet (SDS)"], ["certificate", "Certificate / authorisation"],
  ["historical_test", "Historical test result"], ["third_party_assessment", "Third-party assessment"], ["user_declaration", "Self declaration"]];
const u = (p: string) => (p === "temperature_C" ? "°C" : p === "calorific_value_MJkg" ? " MJ/kg" : "%");

function EvidenceForm({ sid, props }: { sid: string; props: string[] }) {
  const [type, setType] = useState("lab_report");
  const [title, setTitle] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ issuer: "", issue_date: "", expiry_date: "", batch_code: "", test_method: "" });
  const [ex, setEx] = useState<{ method: string | null; found: number; note: string; snippets: Record<string, string> } | null>(null);
  const [reading, setReading] = useState(false);
  const chooseFile = async (f: File | null) => {
    setFile(f); setEx(null);
    if (!f) return;
    setReading(true);
    try {
      const r = await extractDocument(f);
      setEx({ method: r.method, found: r.found, note: r.note, snippets: r.snippets });
      if (r.found) setVals((v) => ({ ...v, ...Object.fromEntries(Object.entries(r.values).map(([k, x]) => [k, String(x)])) }));
      setMeta((m) => ({ ...m, issuer: r.issuer ?? m.issuer, issue_date: r.issue_date ?? m.issue_date, batch_code: r.batch_code ?? m.batch_code, test_method: r.test_method ?? m.test_method }));
      if (!title && r.found) setTitle(f.name.replace(/\.[^.]+$/, ""));
    } catch { setEx({ method: null, found: 0, note: "Could not read this file; enter values manually.", snippets: {} }); } finally { setReading(false); }
  };
  const up = useApiMutation((fd: FormData) => api.post(`/materials/${sid}/evidence`, fd).then((r) => r.data), [["passport", sid], ["assessment"]]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append("type", type); fd.append("title", title);
    fd.append("reported_values", JSON.stringify(Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => [k, +v]))));
    Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v));
    fd.append("extraction_method", ex?.method && ex.found ? ex.method : "manual");
    if (file) fd.append("file", file);
    up.mutate(fd, { onSuccess: () => { setTitle(""); setVals({}); setFile(null); setEx(null); setMeta({ issuer: "", issue_date: "", expiry_date: "", batch_code: "", test_method: "" }); } });
  };
  return (
    <form onSubmit={submit} className="rounded-lg border border-dashed border-border p-4 space-y-3 bg-subtle/50" data-demo="evidence-form">
      <div className="font-semibold text-sm flex items-center gap-2"><Upload size={15} /> Add evidence</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{EV_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input" required placeholder="Title, e.g. NABL lab report Mar 2026" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <input className="input" placeholder="Issuer (lab / authority)" value={meta.issuer} onChange={(e) => setMeta({ ...meta, issuer: e.target.value })} />
        <label className="text-[11px] text-muted">Issue date<input className="input mt-0.5" type="date" value={meta.issue_date} onChange={(e) => setMeta({ ...meta, issue_date: e.target.value })} /></label>
        <label className="text-[11px] text-muted">Expiry date (if any)<input className="input mt-0.5" type="date" value={meta.expiry_date} onChange={(e) => setMeta({ ...meta, expiry_date: e.target.value })} /></label>
        <input className="input" placeholder="Batch ID (optional)" value={meta.batch_code} onChange={(e) => setMeta({ ...meta, batch_code: e.target.value })} />
        <input className="input sm:col-span-2" placeholder="Test method, e.g. XRF, IS 1727" value={meta.test_method} onChange={(e) => setMeta({ ...meta, test_method: e.target.value })} />
      </div>
      <div>
        <div className="label mb-1">Values stated in the document (optional)</div>
        <div className="flex flex-wrap gap-2">{[...new Set([...props, "purity_pct"])].map((p) => (
          <label key={p} className="flex items-center gap-1 text-xs rounded-lg border border-border bg-surface px-2 py-1">{p.replace("_pct", "").replace("_MJkg", "")}
            <input className="w-14 outline-none" type="number" step="any" value={vals[p] ?? ""} onChange={(e) => setVals({ ...vals, [p]: e.target.value })} />{u(p)}</label>))}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-ghost cursor-pointer !py-1.5 text-xs"><Paperclip size={13} /> {file ? file.name : "Attach PDF / image (max 5 MB)"}
          <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.csv,.txt" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} /></label>
        <button className="btn-primary !py-1.5 ml-auto" disabled={up.isPending || !title}>{up.isPending ? "Uploading…" : "Submit evidence"}</button>
      </div>
      {reading && <p className="text-xs text-sky">Reading the document…</p>}
      {ex && <div className={`rounded-md border px-3 py-2 text-xs ${ex.found ? "border-sky/30 bg-sky-soft text-ink" : "border-border bg-subtle text-muted"}`} data-demo="extraction">
        {ex.found ? <>Extracted {ex.found} value{ex.found > 1 ? "s" : ""} from the document ({ex.method === "llm" ? "AI reading" : "text parsing"}): {Object.values(ex.snippets).join(" · ")}. {ex.note}</> : ex.note ?? "No values found; enter them manually."}
      </div>}
      {up.isError && <p className="text-xs text-danger">{apiError(up.error)}</p>}
      <p className="text-[11px] text-muted">Submitted values are shown as <b>Document</b>. They become <b>Lab verified</b> only after a facilitator checks them.</p>
    </form>
  );
}

export default function MaterialPassport() {
  const { id } = useParams();
  const auth = useAuth();
  const q = usePassport(id);
  const pw = usePathways(id);
  const photos = useSupplyPhotos(id);
  const qc = useQueryClient();
  const [qty, setQty] = useState("");
  const refresh = useApiMutation((b: object) => api.post(`/materials/${id}/availability`, b).then((r) => r.data), [["passport", id], ["assessment"]]);
  const edit = useApiMutation((b: object) => api.patch(`/materials/${id}`, b).then((r) => r.data), [["passport", id], ["assessment"], ["pathways", id]]);
  const verify = useApiMutation(({ eid, status }: { eid: number; status: string }) => api.post(`/evidence/${eid}/verify`, { status }).then((r) => r.data), [["passport", id], ["assessment"]]);
  const d = q.data;
  const facilitator = auth.user?.role === "facilitator";

  const header = (
    <AppHeader eyebrow="Materials / passport" title={d ? d.material : "…"}
      description={d ? <span className="flex flex-wrap items-center gap-2">{d.company.hidden ? <><Lock size={14} /> Confidential supplier · {d.company.address}</> :
        <><MapPin size={14} /><Link to={`/industry/${d.company.id}`} className="underline">{d.company.name}</Link> · {d.company.cluster}</>}
        · {titleCase(d.category)} {d.physical_state ? `· ${d.physical_state}` : ""}</span> : ""}
      right={d && <div className="flex flex-wrap gap-2">{d.trust.labels.map((l) => l === "REQUIRES EVIDENCE" ? <RequiresEvidence key={l} /> : <TrustBadge key={l} trust={d.trust.status} />)}
        {d.hazardous && <span className="chip bg-danger text-white"><ShieldAlert size={11} /> HAZARDOUS</span>}</div>} />
  );
  if (q.error) return <AppPage header={header}><ErrorState error={q.error} /></AppPage>;
  if (!d) return <AppPage header={header}><Skeleton className="h-96" /></AppPage>;
  const unit = d.quantity.unit.split("/")[0];

  return (
    <AppPage header={header}>
      <div className="grid xl:grid-cols-[1fr_420px] gap-5">
        <div className="space-y-5 min-w-0">
          <section className="card p-5 grid sm:grid-cols-3 gap-4">
            <div><div className="label">Quantity</div><div className="font-display text-2xl font-semibold">{num(d.quantity.value)} <span className="text-sm text-muted">{d.quantity.unit}</span></div>
              <div className="text-xs mt-1 flex items-center gap-1"><BasisTag basis={d.quantity.source === "USER DECLARED" ? "USER PROVIDED" : "ESTIMATE"} /> {d.quantity.source === "AI INFERRED" && `${Math.round(d.quantity.confidence * 100)}% confidence`}</div></div>
            <div><div className="label">Best match value</div><div className="font-display text-2xl font-semibold text-emerald">{inr(d.economics.best_match_value_per_year)}<span className="text-sm text-muted">/yr</span></div>
              <div className="text-xs text-muted mt-1">{d.economics.match_count} potential buyers · estimate</div></div>
            <div><div className="label">{d.economics.disposal_cost_per_unit >= 0 ? "Disposal cost today" : "Current sale value"}</div><div className="font-display text-2xl font-semibold">{inr(Math.abs(d.economics.disposal_cost_per_unit))}<span className="text-sm text-muted">/{unit}</span></div>
              <div className="text-xs text-muted mt-1">CO2 potential {num(d.environment.best_co2_per_year)} t/yr</div></div>
            <div className="sm:col-span-3">
              <div className="label mb-1">Availability by month</div>
              <div className="flex items-end gap-1 h-10">{d.availability.seasonality.map((v, i) => <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.availability.months[i]}: ${Math.round(v * 100)}%`}>
                <div className="w-full rounded-sm bg-brand/70" style={{ height: `${Math.max(v * 32, 2)}px` }} /><span className="text-[9px] text-muted">{d.availability.months[i][0]}</span></div>)}</div>
            </div>
          </section>

          <section className="card p-5" data-demo="passport-photos">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><div className="section-title">Photos</div>
              <p className="section-sub">Buyers compare these with a photo of the material they need (Photo match). Appearance is indicative only.</p></div>
              <Link to="/photos?mode=search" className="btn-link text-xs">Search with a photo →</Link></div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {photos.data?.map((p) => <PhotoCard key={p.id} p={p} onDelete={d.owner ? () => deletePhoto(p.id).then(() => { qc.invalidateQueries({ queryKey: ["photos"] }); qc.invalidateQueries({ queryKey: ["visual"] }); }) : undefined} />)}
              {!photos.data?.length && <p className="text-sm text-muted">No photos yet.</p>}
            </div>
            {d.owner && <div className="mt-3"><PhotoUploader path={`/materials/${d.id}/images`} label="Add photo" onUploaded={() => qc.invalidateQueries({ queryKey: ["photos"] })} /></div>}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Composition & properties</h2>
            <p className="text-xs text-muted mb-3">Each value shows where it comes from. Trust levels are never merged.</p>
            <table className="w-full text-sm"><tbody className="divide-y divide-border">
              {d.properties.map((p) => <tr key={p.property}><td className="py-2 font-medium">{p.label}</td><td className="tabular-nums">{p.value}{u(p.property)}</td><td className="text-right"><SourceTag source={p.source} /></td></tr>)}
            </tbody></table>
            {d.trust.assumptions.length > 0 && <div className="mt-4 rounded-lg bg-amber/5 border border-amber/20 p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-amber mb-1">Assumptions</div>
              <ul className="list-disc pl-5 space-y-0.5 text-muted">{d.trust.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              {d.trust.reasoning && <p className="text-xs text-muted mt-2">Reasoning: {d.trust.reasoning}</p>}
            </div>}
            {d.owner && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3" data-demo="confirm-qty">
                <span className="text-sm font-medium">Is this right?</span>
                <input className="input !w-40" type="number" placeholder={`${Math.round(d.quantity.value)} ${d.quantity.unit}`} value={qty} onChange={(e) => setQty(e.target.value)} />
                <button className="btn-primary !py-2" disabled={edit.isPending} onClick={() => edit.mutate({ confirm_availability: true, monthly_tonnes: qty ? +qty : undefined })}>Confirm availability</button>
                {edit.isError && <span className="text-xs text-danger">{apiError(edit.error)}</span>}
              </div>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between mb-3"><div className="section-title">Supply assurance</div>{!d.owner && <span className="text-xs text-muted">Only the generating company can update availability</span>}</div>
            <SupplyPanel s={d.supply} />
            {d.owner && <form className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-border p-3" data-demo="refresh-availability" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
              refresh.mutate({ available_tonnes: +(f.get("t") as string), min_order_tonnes: f.get("mo") ? +(f.get("mo") as string) : undefined, delivery_window: (f.get("w") as string) || undefined }); }}>
              <label><span className="label">Available this month</span><input name="t" required type="number" min={1} className="input mt-1 !w-40" defaultValue={Math.round(d.quantity.value)} /></label>
              <label><span className="label">Minimum order</span><input name="mo" type="number" min={0} className="input mt-1 !w-32" defaultValue={d.supply.min_order ?? ""} /></label>
              <label className="flex-1 min-w-[200px]"><span className="label">Delivery window</span><input name="w" className="input mt-1" defaultValue={d.supply.delivery_window ?? ""} placeholder="e.g. Mon-Sat, gate 3" /></label>
              <button className="btn-primary" disabled={refresh.isPending}>Update availability</button>
            </form>}
          </section>

          <section className="card p-5">
            <div className="section-title">Supplier track record on Sylithex</div>
            <p className="section-sub mb-3">{d.track_record.label}. Built only from exchanges and batches recorded on the platform.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md border border-border p-3"><div className="text-xs text-muted">Exchanges</div><div className="font-semibold">{d.track_record.exchanges} ({d.track_record.completed} completed)</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-xs text-muted">Delivered</div><div className="font-semibold tabular-nums">{num(d.track_record.delivered_tonnes)} t in {d.track_record.batches} batches</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-xs text-muted">Rejection rate</div><div className="font-semibold tabular-nums">{d.track_record.rejection_rate_pct != null ? `${d.track_record.rejection_rate_pct}%` : "-"}</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-xs text-muted">Evidence accepted</div><div className="font-semibold tabular-nums">{d.track_record.evidence_accepted} of {d.track_record.evidence_documents}</div></div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold flex items-center gap-2"><Route size={17} /> Reuse pathways</h2>
            <p className="text-xs text-muted mb-3">{pw.data?.note}</p>
            {pw.isLoading ? <Skeleton className="h-40" /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
                <thead className="text-left text-[11px] uppercase tracking-wider text-muted bg-bg"><tr><th className="px-3 py-2 font-medium">Pathway</th><th className="font-medium">Technical fit</th><th className="font-medium">Processing</th><th className="font-medium">Nearest buyer</th><th className="font-medium text-right">Value / yr</th><th className="font-medium text-right">CO2 / yr</th><th className="font-medium pl-4">Evidence & permits</th></tr></thead>
                <tbody className="divide-y divide-border">{pw.data?.pathways.map((p) => (
                  <tr key={p.application} className="align-top">
                    <td className="px-3 py-2.5"><div className="font-medium">{p.application}</div><div className="text-[11px] text-muted">{p.kind === "network" ? `${p.buyers_in_network} buyers in network` : "Market route, no registered buyer"}</div></td>
                    <td className="py-2.5">{typeof p.technical_fit === "number" ? `${Math.round(p.technical_fit * 100)}%` : titleCase(p.technical_fit)}</td>
                    <td className="py-2.5 text-xs">{p.processing.length ? p.processing.map((s) => s.step).join(", ") : "None"}<div className="text-muted">{inr(p.processing_cost)}/t</div></td>
                    <td className="py-2.5">{p.nearest_km != null ? `${p.nearest_km} km` : "-"}</td>
                    <td className="py-2.5 text-right tabular-nums">{inr(p.value_per_year)}<div className="text-[10px] text-muted">{p.basis}</div></td>
                    <td className="py-2.5 text-right tabular-nums">{num(p.co2_per_year)} t</td>
                    <td className="py-2.5 pl-4 text-xs text-muted">{[...p.evidence, ...p.regulatory].join(" · ")}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold flex items-center gap-2"><FileText size={17} /> Evidence ({d.evidence.length})</h2>
            <div className="mt-3 space-y-2">
              {d.evidence.map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="font-medium">{e.title}</div><div className="text-xs text-muted">{EV_TYPES.find(([k]) => k === e.type)?.[1]}{e.issuer ? ` · ${e.issuer}` : ""}{e.issue_date ? ` · issued ${e.issue_date}` : ` · uploaded ${new Date(e.uploaded_at).toLocaleDateString("en-IN")}`}{e.expiry_date ? ` · expires ${e.expiry_date}` : ""}{e.test_method ? ` · ${e.test_method}` : ""}</div></div>
                    <span className={`chip whitespace-nowrap ${e.state === "accepted" ? "bg-emerald-soft text-emerald" : ["rejected", "expired"].includes(e.state) ? "bg-danger-soft text-danger" : e.state === "revalidation_required" ? "bg-amber-soft text-amber" : "bg-sky-soft text-sky"}`}>{e.state === "accepted" ? <ShieldCheck size={11} /> : null}{e.state === "accepted" ? "Accepted" : e.state === "under_review" ? "Under review" : e.state === "revalidation_required" ? "Revalidate" : titleCase(e.state)}</span>
                  </div>
                  {Object.keys(e.reported_values).length > 0 && <div className="text-xs mt-1.5">{Object.entries(e.reported_values).map(([k, v]) => `${k.replace("_pct", "")} ${v}${u(k)}`).join(" · ")}</div>}
                  <div className="flex items-center gap-2 mt-2">
                    {e.file_accessible ? <a className="text-xs text-brand underline" href={`${api.defaults.baseURL}/evidence/${e.id}/file`} onClick={(ev) => { ev.preventDefault(); api.get(`/evidence/${e.id}/file`, { responseType: "blob" }).then((r) => window.open(URL.createObjectURL(r.data))); }}>Open file</a>
                      : e.has_file ? <span className="text-xs text-muted flex items-center gap-1"><Lock size={11} /> File shared after mutual consent</span> : <span className="text-xs text-muted">No file attached</span>}
                    {facilitator && e.status === "submitted" && <span className="ml-auto flex gap-1">
                      <button className="btn-green !py-1 !px-3 text-xs" onClick={() => verify.mutate({ eid: e.id, status: "verified" })}>Verify</button>
                      <button className="btn-ghost !py-1 !px-3 text-xs" onClick={() => verify.mutate({ eid: e.id, status: "rejected" })}>Reject</button></span>}
                  </div>
                </div>
              ))}
              {!d.evidence.length && <p className="text-sm text-muted">No evidence yet. Buyers will see this material as <b>requires evidence</b>.</p>}
            </div>
            {d.owner && <div className="mt-4"><EvidenceForm sid={String(d.id)} props={d.properties.map((p) => p.property)} /></div>}
          </section>

          {d.hazardous && <section className="card p-5 border-danger/30"><h2 className="font-semibold flex items-center gap-2 text-danger"><ShieldAlert size={17} /> Regulatory</h2>
            <ul className="text-sm mt-2 space-y-1 list-disc pl-5">{d.regulatory.map((r) => <li key={r}>{r}</li>)}</ul></section>}

          <section className="card p-5">
            <h2 className="font-semibold">Accepted as</h2>
            <ul className="mt-2 space-y-2 text-sm">{d.applications.map((a) => <li key={a.industry_type + a.raw_material}><b>{a.raw_material}</b> <span className="text-muted">in {metaFor(a.industry_type).label.toLowerCase()}</span>
              <div className="text-xs text-muted">{Object.entries(a.required_spec).map(([k, [lo, hi]]) => `${k.replace("_pct", "")} ${lo}-${hi}`).join(" · ") || "no spec"}</div></li>)}</ul>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Potential buyers</h2>
            <div className="mt-2 divide-y divide-border">{d.top_matches.map((m) => (
              <Link key={m.id} to={`/match/${m.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-brand">
                <span className="truncate">{m.buyer.name}<span className="block text-xs text-muted">{m.material} · {Math.round(m.distance_km)} km</span></span><ScorePill score={m.score} /></Link>))}</div>
          </section>
        </aside>
      </div>
    </AppPage>
  );
}
