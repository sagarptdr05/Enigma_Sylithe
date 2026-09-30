import { ArrowRight, FlaskConical, Lock } from "lucide-react";
import type { RouteRow } from "../../types";
import { inr, num } from "../../lib/format";
import { PropStatusBadge } from "../cards/Badges";

export default function RoutesPanel({ routes, note }: { routes: RouteRow[]; note?: string }) {
  if (!routes.length) return <p className="text-sm text-muted">No processing route improves on the direct options for this requirement.</p>;
  return (
    <div className="space-y-3" data-demo="routes">
      {routes.map((r) => (
        <div key={`${r.waste_stream_id}-${r.processor.id}`} className="rounded-lg border border-border">
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm border-b border-border">
            <span className="font-medium flex items-center gap-1">{r.source.hidden && <Lock size={12} />}{r.source.name}</span><span className="text-muted">{r.material}</span>
            <ArrowRight size={14} className="text-muted" /><span className="font-medium flex items-center gap-1"><FlaskConical size={14} className="text-sky" />{r.processor.name}</span>
            <ArrowRight size={14} className="text-muted" /><span className="text-muted">you</span>
            <span className={`ml-auto chip border ${r.processor.status === "confirmed" ? "bg-emerald-soft text-emerald border-emerald/30" : "bg-subtle text-muted border-border"}`}>{r.processor.source === "synthetic" ? "Example facility" : "Registered facility"} · {r.processor.status}</span>
            <span className="chip bg-amber-soft text-amber border border-amber/30">{r.status === "hypothesis" ? "Hypothesis, needs validation" : "Inputs confirmed, trial still required"}</span>
          </div>
          <div className="px-4 py-3 grid md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-muted">Distance</div><div className="tabular-nums">{r.legs_km[0]} + {r.legs_km[1]} km</div></div>
            <div><div className="text-xs text-muted">Usable after processing</div><div className="tabular-nums">{num(r.usable_tonnes)} t/month <span className="text-muted text-xs">({Math.round(r.processor.yield * 100)}% yield{r.capacity_limited ? ", capacity-limited" : ""})</span></div></div>
            <div><div className="text-xs text-muted">Landed ₹/usable t</div><div className="tabular-nums font-medium">{r.landed_cost_per_usable_tonne != null ? inr(r.landed_cost_per_usable_tonne) : "-"} {r.saving_per_usable_tonne != null && <span className={`text-xs ${r.saving_per_usable_tonne > 0 ? "text-emerald" : "text-danger"}`}>({r.saving_per_usable_tonne > 0 ? "saves" : "costs"} {inr(Math.abs(r.saving_per_usable_tonne))})</span>}</div></div>
            <div><div className="text-xs text-muted">Processing</div><div>{r.processor.steps.join(", ")}</div></div>
          </div>
          <div className="px-4 pb-3 grid md:grid-cols-2 gap-4">
            <table className="table text-[13px]"><thead><tr><th className="!px-2">Property</th><th className="!px-2">Before</th><th className="!px-2">After processing</th></tr></thead>
              <tbody>{r.properties_after.map((a, i) => <tr key={a.property}><td className="!px-2">{a.label}</td><td className="!px-2"><PropStatusBadge status={r.properties_before[i].status} /></td><td className="!px-2"><PropStatusBadge status={a.status} /></td></tr>)}</tbody></table>
            <div className="text-xs">
              <div className="font-medium text-ink mb-1">Unresolved checks</div>
              <ul className="list-disc pl-4 space-y-0.5 text-muted">{r.unresolved.map((u) => <li key={u}>{u}</li>)}</ul>
              <div className="font-medium text-ink mt-2 mb-1">Assumptions</div>
              <ul className="list-disc pl-4 space-y-0.5 text-muted">{r.assumptions.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
          </div>
        </div>
      ))}
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  );
}
