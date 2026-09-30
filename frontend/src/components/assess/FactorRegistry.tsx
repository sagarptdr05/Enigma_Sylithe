import { useState } from "react";
import { CheckCircle2, CircleDashed, Pencil } from "lucide-react";
import { api, apiError, useApiMutation, useFactors } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Skeleton } from "../cards/Feedback";
import type { FactorRow } from "../../types";

function Row({ f, editable }: { f: FactorRow; editable: boolean }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ value: String(f.value), source: f.source, reference_year: f.reference_year ?? "" });
  const m = useApiMutation((b: object) => api.patch(`/factors/${f.key}`, b).then((r) => r.data), [["factors"], ["impact"], ["matches"], ["exchange"]]);
  if (edit) return (
    <tr><td className="font-medium">{f.label}</td>
      <td colSpan={4}>
        <div className="grid md:grid-cols-[120px_1fr_120px_auto] gap-2">
          <input className="input !h-8" type="number" step="any" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
          <input className="input !h-8" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} placeholder="Source (publication, version)" />
          <input className="input !h-8" value={v.reference_year} onChange={(e) => setV({ ...v, reference_year: e.target.value })} placeholder="Year" />
          <div className="flex gap-1"><button className="btn-green !h-8 text-xs" onClick={() => m.mutate({ value: +v.value, source: v.source, reference_year: v.reference_year || undefined }, { onSuccess: () => setEdit(false) })}>Save as reviewed</button>
            <button className="btn-ghost !h-8 text-xs" onClick={() => setEdit(false)}>Cancel</button></div>
        </div>
        {m.isError && <p className="text-xs text-danger mt-1">{apiError(m.error)}</p>}
      </td></tr>
  );
  return (
    <tr>
      <td className="font-medium">{f.label}</td>
      <td className="tabular-nums text-right">{f.value}</td>
      <td className="text-xs text-muted">{f.unit}</td>
      <td className="text-xs">{f.source}{f.reference_year && <span className="text-muted"> · {f.reference_year}</span>}{f.updated_by && <div className="text-muted">Reviewed by {f.updated_by}</div>}</td>
      <td><span className={`text-xs font-medium inline-flex items-center gap-1 ${f.status === "reviewed" ? "text-emerald" : "text-amber"}`}>{f.status === "reviewed" ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}{f.status === "reviewed" ? "Reviewed" : "Default, verify"}</span>
        {editable && <button className="ml-2 text-muted hover:text-ink" onClick={() => setEdit(true)} aria-label={`Edit ${f.label}`}><Pencil size={13} /></button>}</td>
    </tr>
  );
}

export default function FactorRegistry() {
  const q = useFactors();
  const auth = useAuth();
  if (!q.data) return <Skeleton className="h-48" />;
  return (
    <div data-demo="factors">
      <div className="overflow-x-auto border border-border rounded-md">
        <table className="table min-w-[860px]"><thead><tr><th>Factor</th><th className="text-right">Value</th><th>Unit</th><th>Source</th><th>Status</th></tr></thead>
          <tbody>{q.data.factors.map((f) => <Row key={f.key} f={f} editable={auth.user?.role === "facilitator"} />)}</tbody></table>
      </div>
      <p className="text-[11px] text-muted mt-2">{q.data.note} Transport = diesel combustion × truck fuel intensity; processing = step energy × grid factor. Updating a factor recalculates matches, scenarios and impact.</p>
    </div>
  );
}
