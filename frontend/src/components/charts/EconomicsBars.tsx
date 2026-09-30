import { inr } from "../../lib/format";

export default function EconomicsBars({ e }: { e: { virgin_price: number; transport_cost: number; processing_cost: number; disposal_avoided: number; saving_per_tonne: number } }) {
  const rows = [
    { label: "Virgin material price", v: e.virgin_price, color: "#0284C7", sign: "" },
    { label: "Transport", v: -e.transport_cost, color: "#DC2626", sign: "−" },
    { label: "Processing", v: -e.processing_cost, color: "#D97706", sign: "−" },
    e.disposal_avoided >= 0
      ? { label: "Disposal cost avoided", v: e.disposal_avoided, color: "#7C3AED", sign: "+" }
      : { label: "Current sale value forgone (already sold today)", v: e.disposal_avoided, color: "#DC2626", sign: "−" },
    { label: "Net saving per tonne", v: e.saving_per_tonne, color: "#16A34A", sign: "=" },
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.v)), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted">{r.sign} {r.label}</span>
            <span className="tabular-nums" style={{ color: r.color }}>{inr(Math.abs(r.v))}/t</span>
          </div>
          <div className="h-2 rounded-full bg-border overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(Math.abs(r.v) / max) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
