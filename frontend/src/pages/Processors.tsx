import { useState, type FormEvent } from "react";
import { CheckCircle2, CircleDashed, FlaskConical, Plus } from "lucide-react";
import AppHeader, { AppPage } from "../components/layout/AppHeader";
import { Skeleton } from "../components/cards/Feedback";
import { api, apiError, useApiMutation, useClusters, useProcessors } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { inr, num } from "../lib/format";

function RegisterForm({ materials, properties, onDone }: { materials: string[]; properties: string[]; onDone: () => void }) {
  const clusters = useClusters();
  const [f, setF] = useState({ name: "", cluster: "Taloja MIDC", output_label: "", yield_share: 0.9, cost_per_tonne: 400, capacity_tpm: 1000, steps: "Drying, Grinding", energy_kwh_per_tonne: "", hazardous_permitted: false });
  const [accepts, setAccepts] = useState<string[]>([]);
  const [sets, setSets] = useState<{ p: string; v: string }[]>([{ p: "moisture", v: "8" }]);
  const m = useApiMutation((b: object) => api.post("/processors", b).then((r) => r.data), [["processors"], ["routes"]]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ ...f, accepts, steps: f.steps.split(",").map((x) => x.trim()).filter(Boolean), energy_kwh_per_tonne: f.energy_kwh_per_tonne ? +f.energy_kwh_per_tonne : null,
      sets: Object.fromEntries(sets.filter((x) => x.v !== "").map((x) => [x.p, +x.v])) }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="card p-5 space-y-3" data-demo="register-processor">
      <div className="section-title">Register a processing facility</div>
      <div className="grid md:grid-cols-2 gap-3">
        <label><span className="label">Facility name</span><input className="input mt-1" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><span className="label">Cluster</span><select className="input mt-1" value={f.cluster} onChange={(e) => setF({ ...f, cluster: e.target.value })}>{clusters.data?.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
      </div>
      <div><span className="label">Accepted input materials</span>
        <div className="flex flex-wrap gap-1.5 mt-1">{materials.map((x) => <button type="button" key={x} onClick={() => setAccepts(accepts.includes(x) ? accepts.filter((a) => a !== x) : [...accepts, x])}
          className={`chip border !text-xs !py-1 ${accepts.includes(x) ? "bg-brand text-white border-brand" : "bg-surface border-border text-ink"}`}>{x}</button>)}</div></div>
      <div className="grid md:grid-cols-3 gap-3">
        <label><span className="label">Output description</span><input className="input mt-1" required value={f.output_label} onChange={(e) => setF({ ...f, output_label: e.target.value })} placeholder="e.g. Dried, ground gypsum" /></label>
        <label><span className="label">Processing steps (comma separated)</span><input className="input mt-1" value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></label>
        <label><span className="label">Energy use (kWh/t, optional)</span><input className="input mt-1" type="number" value={f.energy_kwh_per_tonne} onChange={(e) => setF({ ...f, energy_kwh_per_tonne: e.target.value })} /></label>
        <label><span className="label">Yield (0-1)</span><input className="input mt-1" type="number" step="0.01" min={0.05} max={1} value={f.yield_share} onChange={(e) => setF({ ...f, yield_share: +e.target.value })} /></label>
        <label><span className="label">Gate fee ₹/t</span><input className="input mt-1" type="number" value={f.cost_per_tonne} onChange={(e) => setF({ ...f, cost_per_tonne: +e.target.value })} /></label>
        <label><span className="label">Capacity t/month</span><input className="input mt-1" type="number" value={f.capacity_tpm} onChange={(e) => setF({ ...f, capacity_tpm: +e.target.value })} /></label>
      </div>
      <div><span className="label">Guaranteed output properties</span>
        <div className="flex flex-wrap gap-2 mt-1">{sets.map((r, i) => (
          <div key={i} className="flex items-center gap-1 border border-border rounded-md px-2 h-8 text-xs">
            <select value={r.p} onChange={(e) => setSets(sets.map((x, j) => j === i ? { ...x, p: e.target.value } : x))}>{properties.map((p) => <option key={p}>{p}</option>)}</select>
            <input className="w-14 outline-none" type="number" step="any" value={r.v} onChange={(e) => setSets(sets.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} /></div>))}
          <button type="button" className="btn-ghost !h-8 !px-2 text-xs" onClick={() => setSets([...sets, { p: "purity_pct", v: "" }])}><Plus size={12} /> Property</button></div></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand" checked={f.hazardous_permitted} onChange={(e) => setF({ ...f, hazardous_permitted: e.target.checked })} /> Facility is authorised to handle hazardous inputs</label>
      {m.isError && <p className="text-sm text-danger">{apiError(m.error)}</p>}
      <div className="flex justify-between items-center"><p className="text-xs text-muted">Registered facilities appear in route discovery as “unconfirmed” until you confirm the figures as current quotes.</p>
        <button className="btn-primary" disabled={m.isPending || !accepts.length}>Register facility</button></div>
    </form>
  );
}

export default function Processors() {
  const q = useProcessors();
  const auth = useAuth();
  const [show, setShow] = useState(false);
  const confirm = useApiMutation((id: number) => api.post(`/processors/${id}/confirm`).then((r) => r.data), [["processors"], ["routes"]]);
  const d = q.data;
  const can = (op: number | null, source: string) => auth.user?.role === "facilitator" || (source === "registered" && op != null && op === auth.user?.industry?.id);
  return (
    <AppPage header={<AppHeader eyebrow="Source & evaluate / Processing facilities" title="Processing facilities (missing links)"
      description="Facilities that turn a by-product into a usable input: drying, grinding, washing, regeneration, pelletising, composting. Route discovery uses these records with their yield, capacity and gate fee. Example facilities are synthetic; registered ones come from their operators."
      right={auth.user && <button className="btn-primary" onClick={() => setShow(!show)}><Plus size={15} /> Register a facility</button>} />}>
      {show && d && <div className="mb-6"><RegisterForm materials={d.input_materials} properties={d.properties} onDone={() => setShow(false)} /></div>}
      {confirm.isError && <p className="text-sm text-danger mb-3">{apiError(confirm.error)}</p>}
      {!d ? <Skeleton className="h-64" /> : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[980px]">
            <thead><tr><th>Facility</th><th>Accepts</th><th>Output</th><th className="text-right">Yield</th><th className="text-right">Gate fee</th><th className="text-right">Capacity</th><th>Record</th><th /></tr></thead>
            <tbody>{d.processors.map((p) => (
              <tr key={p.id}>
                <td><div className="font-medium flex items-center gap-1.5"><FlaskConical size={14} className="text-sky" />{p.name}</div><div className="text-xs text-muted">{p.cluster} · {p.steps.join(", ")}</div></td>
                <td className="text-xs">{p.accepts.join(", ")}{p.hazardous_permitted && <div className="text-emerald">Hazardous permitted</div>}</td>
                <td className="text-xs">{p.output_label}<div className="text-muted">{Object.entries(p.sets).map(([k, v]) => `${k.replace("_pct", "")} ${v}`).join(", ")}</div></td>
                <td className="text-right tabular-nums">{Math.round(p.yield * 100)}%</td>
                <td className="text-right tabular-nums">{inr(p.cost_per_tonne)}/t</td>
                <td className="text-right tabular-nums">{num(p.capacity_tpm)} t/mo</td>
                <td><div className={`text-xs font-medium flex items-center gap-1 ${p.status === "confirmed" ? "text-emerald" : "text-amber"}`}>{p.status === "confirmed" ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}{p.status === "confirmed" ? "Confirmed by operator" : "Unconfirmed"}</div>
                  <div className="text-[11px] text-muted">{p.source === "synthetic" ? "Example facility (synthetic)" : "Registered"}</div></td>
                <td className="text-right">{p.status !== "confirmed" && can(p.operator_industry_id, p.source) && <button className="btn-ghost !h-8 text-xs" onClick={() => confirm.mutate(p.id)}>Confirm figures</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </AppPage>
  );
}
