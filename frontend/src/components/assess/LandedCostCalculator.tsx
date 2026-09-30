import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { calcLandedCost } from "../../api/client";
import { inr, num } from "../../lib/format";
import { BasisTag } from "../cards/Badges";
import type { LandedCost } from "../../types";

const FIELDS: [string, string, number][] = [
  ["material_price", "Material price ₹/t", 10], ["transport_rate", "Freight ₹/t-km", 0.1], ["distance_km", "Distance km", 1],
  ["loading_unloading", "Loading / unloading ₹/t", 5], ["handling", "Handling ₹/t", 5], ["storage", "Storage ₹/t", 5],
  ["processing", "Processing ₹/t", 10], ["testing_per_month", "Testing ₹/month", 500], ["other", "Other ₹/t", 5],
  ["monthly_tonnes", "Delivered t/month", 10], ["acceptance_yield", "Acceptance yield (0-1)", 0.01], ["processing_yield", "Processing yield (0-1)", 0.01],
  ["baseline_price", "Conventional material ₹/usable t", 10],
];

/** True landed cost per usable tonne. Inputs are editable; nothing is saved. */
export default function LandedCostCalculator({ matchId, initial }: { matchId: number; initial: LandedCost }) {
  const [res, setRes] = useState<LandedCost>(initial);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!Object.keys(vals).length) { setRes(initial); return; }
    const t = setTimeout(() => {
      setBusy(true);
      calcLandedCost(matchId, Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== "").map(([k, v]) => [k, +v]))).then(setRes).finally(() => setBusy(false));
    }, 350);
    return () => clearTimeout(t);
  }, [vals, matchId, initial]);
  const v = (k: string) => vals[k] ?? String(res.inputs[k] ?? "");
  const verdictCls = res.verdict === "cheaper" ? "text-emerald" : res.verdict === "premium" ? "text-danger" : "text-amber";
  return (
    <div className="grid xl:grid-cols-[320px_1fr] gap-6" data-demo="landed-cost">
      <div>
        <div className="flex items-center justify-between mb-2"><div className="section-title">Inputs</div>
          {Object.keys(vals).length > 0 && <button className="btn-link text-xs inline-flex items-center gap-1" onClick={() => setVals({})}><RotateCcw size={12} /> Reset</button>}</div>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(([k, l, step]) => (
            <label key={k} className="block"><span className="text-[11px] text-muted">{l}</span>
              <input className="input !h-8 mt-0.5 tabular-nums" type="number" step={step} min={0} value={v(k)} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></label>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-2">Material price basis: <BasisTag basis={String(res.inputs.material_price_basis ?? "ESTIMATE")} /> Change any value to test your own quote.</p>
      </div>
      <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Landed cost per usable tonne</div><div className="text-2xl font-semibold tabular-nums">{res.cost_per_usable_tonne != null ? inr(res.cost_per_usable_tonne) : "-"}</div>
            <div className="text-[11px] text-muted">{inr(res.cost_per_delivered_tonne)} per delivered t · {Math.round(res.usable_share * 100)}% usable</div></div>
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Conventional material</div><div className="text-2xl font-semibold tabular-nums">{res.baseline_per_usable_tonne != null ? inr(res.baseline_per_usable_tonne) : "-"}</div>
            <div className="text-[11px] text-muted">same usable-tonne basis</div></div>
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">{res.verdict === "premium" ? "Premium" : "Saving"} per usable tonne</div>
            <div className={`text-2xl font-semibold tabular-nums ${verdictCls}`}>{res.saving_per_usable_tonne != null ? inr(Math.abs(res.saving_per_usable_tonne)) : "Insufficient data"}</div>
            <div className="text-[11px] text-muted">{res.saving_per_month != null ? `${inr(res.saving_per_month)}/month on ${num(res.usable_tonnes_per_month)} usable t` : `Missing: ${res.missing.join(", ")}`}</div></div>
        </div>
        <div className="grid lg:grid-cols-2 gap-5 mt-5">
          <div>
            <div className="section-title mb-2">Cost build-up per delivered tonne</div>
            <table className="table"><tbody>
              {res.lines.map((l) => <tr key={l.label}><td className="!pl-0">{l.label} <BasisTag basis={l.basis} /></td><td className="text-right tabular-nums !pr-0">{inr(l.per_delivered_tonne)}</td></tr>)}
              <tr><td className="!pl-0 font-medium">Total per delivered tonne</td><td className="text-right tabular-nums font-semibold !pr-0">{inr(res.cost_per_delivered_tonne)}</td></tr>
            </tbody></table>
            <p className="text-[11px] text-muted mt-2">{res.formula}</p>
          </div>
          <div>
            <div className="section-title mb-2">Sensitivity (one change at a time)</div>
            <table className="table"><tbody>
              {res.sensitivity.map((s) => <tr key={s.case}><td className="!pl-0">{s.case}</td><td className="text-right tabular-nums">{s.cost_per_usable_tonne != null ? inr(s.cost_per_usable_tonne) : "-"}</td>
                <td className={`text-right tabular-nums text-xs !pr-0 ${s.delta > 0 ? "text-danger" : "text-emerald"}`}>{s.delta > 0 ? "+" : ""}{inr(s.delta)}</td></tr>)}
            </tbody></table>
            <p className="text-xs mt-3">{res.break_even_km != null ? <>Stays cheaper than the conventional material up to <b>{num(res.break_even_km)} km</b> of haulage.</> : "Break-even distance cannot be computed without a price and baseline."}</p>
            <p className="text-[11px] text-muted mt-2">Not included: {res.exclusions.join("; ")}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
