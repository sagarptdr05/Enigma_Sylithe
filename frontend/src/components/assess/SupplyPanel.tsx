import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed } from "lucide-react";
import type { SupplyPanelData } from "../../types";
import { num } from "../../lib/format";

const REL = { high: "text-emerald", medium: "text-sky", low: "text-danger", not_established: "text-muted" } as const;

export default function SupplyPanel({ s, compact = false }: { s: SupplyPanelData; compact?: boolean }) {
  const max = Math.max(1, ...s.history.map((h) => Math.max(h.available, h.committed ?? 0)));
  const FIcon = s.freshness.status === "fresh" ? CheckCircle2 : s.freshness.status === "stale" ? AlertTriangle : CircleDashed;
  return (
    <div data-demo="supply">
      <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"} gap-3`}>
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Available</div><div className="text-lg font-semibold tabular-nums">{num(s.available)} {s.unit}/month</div>
          <div className="text-[11px] text-muted">{s.min_order ? `Minimum order ${num(s.min_order)} ${s.unit}` : "Minimum order not stated"}</div></div>
        {s.need != null && <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Coverage of buyer demand</div>
          <div className={`text-lg font-semibold tabular-nums ${(s.coverage_pct ?? 0) >= 100 ? "text-emerald" : "text-amber"}`}>{s.coverage_pct}%</div>
          <div className="text-[11px] text-muted">{s.shortfall ? `Shortfall ${num(s.shortfall)} ${s.unit}/month` : "No shortfall"} · need {num(s.need)}</div></div>}
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Data freshness</div>
          <div className={`text-sm font-semibold flex items-center gap-1.5 mt-0.5 ${s.freshness.status === "fresh" ? "text-emerald" : "text-amber"}`}><FIcon size={15} />{s.freshness.status === "fresh" ? "Current" : s.freshness.status === "stale" ? "Stale" : "Unconfirmed"}</div>
          <div className="text-[11px] text-muted">{s.freshness.label}</div></div>
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Delivery reliability</div>
          <div className={`text-sm font-semibold mt-0.5 ${REL[s.reliability.level]}`}>{s.reliability.label}</div>
          <div className="text-[11px] text-muted">{s.reliability.on_time_pct != null ? `On time ${s.reliability.on_time_pct}% · fill ${s.reliability.fill_rate_pct}%` : s.reliability.fill_rate_pct != null ? `Fill ${s.reliability.fill_rate_pct}%` : "No delivery history yet"}
            {s.reliability.acceptance_pct != null ? ` · accepted ${s.reliability.acceptance_pct}%` : ""}
            {s.reliability.basis === "platform" ? " · from platform deliveries" : s.reliability.demo_data ? " · demo data" : s.reliability.basis === "reported" ? " · supplier-reported" : ""}</div></div>
      </div>
      {s.delivery_window && <p className="text-xs text-muted mt-2 flex items-center gap-1"><CalendarClock size={13} /> Delivery window: {s.delivery_window}</p>}
      {!compact && s.history.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between"><div className="section-title">Supply history</div>
            <div className="flex gap-3 text-[11px] text-muted"><span className="flex items-center gap-1"><span className="h-2 w-3 bg-brand/70 rounded-sm" />Available</span><span className="flex items-center gap-1"><span className="h-2 w-3 bg-emerald rounded-sm" />Delivered</span>{s.history.some((h) => h.source === "platform") && <span>Platform deliveries</span>}{s.reliability.demo_data && <span>Includes demo data</span>}</div></div>
          <div className="flex items-end gap-1.5 h-28 mt-2">
            {s.history.map((h) => (
              <div key={h.month} className="flex-1 flex flex-col items-center gap-1" title={`${h.month}: available ${num(h.available)}${h.delivered != null ? `, delivered ${num(h.delivered)} of ${num(h.committed ?? 0)}${h.on_time === false ? " (late)" : ""}` : ""}`}>
                <div className="w-full flex items-end gap-0.5 h-24">
                  <div className="flex-1 bg-brand/70 rounded-sm" style={{ height: `${(h.available / max) * 100}%` }} />
                  {h.delivered != null && <div className={`flex-1 rounded-sm ${h.on_time === false ? "bg-amber" : "bg-emerald"}`} style={{ height: `${(h.delivered / max) * 100}%` }} />}
                </div>
                <span className="text-[10px] text-muted">{h.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
