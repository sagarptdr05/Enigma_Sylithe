import type { Economics } from "../../types";
import { inr, num } from "../../lib/format";
import { BasisTag } from "../cards/Badges";

function Side({ title, lines, net, unit }: { title: string; lines: Economics["buyer"]["lines"]; net: number; unit: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="font-semibold mb-2">{title}</div>
      <div className="space-y-1.5 text-sm">
        {lines.map((l) => (
          <div key={l.label} className="flex items-center justify-between gap-2">
            <span className="text-muted flex items-center gap-1.5">{l.label} <BasisTag basis={l.basis} /></span>
            <span className={`tabular-nums ${l.value < 0 ? "text-danger" : ""}`}>{l.value < 0 ? "−" : "+"}{inr(Math.abs(l.value))}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between border-t border-border mt-3 pt-2 font-semibold"><span>Potential net per {unit}</span><span className={net >= 0 ? "text-emerald" : "text-danger"}>{inr(net)}</span></div>
    </div>
  );
}

export default function TwoSidedEconomics({ e }: { e: Economics }) {
  return (
    <div>
      <div className="grid md:grid-cols-2 gap-3">
        <Side title="Buyer" lines={e.buyer.lines} net={e.buyer.net_per_unit} unit={e.unit} />
        <Side title="Supplier" lines={e.supplier.lines} net={e.supplier.net_per_unit} unit={e.unit} />
      </div>
      <p className="text-xs text-muted mt-3">
        Combined potential: <b className="text-ink">{inr(e.combined_per_year_estimate)}/yr</b> on {num(e.tradable_per_month)} {e.unit}/month, {num(e.co2_per_year_estimate)} tCO2/yr.
        Buyer also bears one-time testing ≈ {inr(e.buyer.testing_one_time)}. {e.note} These are estimates, not guaranteed savings.
      </p>
    </div>
  );
}
