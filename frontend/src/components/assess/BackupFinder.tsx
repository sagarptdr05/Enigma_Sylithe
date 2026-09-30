import { Link } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import { useBackups } from "../../api/client";
import { inr, num } from "../../lib/format";
import { TrustBadge } from "../cards/Badges";
import { Skeleton } from "../cards/Feedback";

const EL: Record<string, string> = { eligible: "Eligible", conditional: "Conditional", not_eligible: "Not eligible" };

export default function BackupFinder({ matchId }: { matchId: number }) {
  const q = useBackups(matchId);
  if (q.isLoading || !q.data) return <Skeleton className="h-48" />;
  const d = q.data;
  const plan = new Map(d.allocation.plan.map((p) => [p.id, p.tonnes]));
  return (
    <div data-demo="backups">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">Buyer demand</div><div className="text-lg font-semibold tabular-nums">{num(d.demand.monthly_tonnes)} t/month</div><div className="text-[11px] text-muted">{d.demand.material}</div></div>
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">This supplier covers</div><div className="text-lg font-semibold tabular-nums">{d.primary?.coverage_pct ?? 0}%</div><div className="text-[11px] text-muted">{d.primary?.shortfall ? `Shortfall ${num(d.primary.shortfall)} t` : "No shortfall"}</div></div>
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted">With backup allocation</div><div className="text-lg font-semibold tabular-nums">{d.allocation.coverage_pct}%</div><div className="text-[11px] text-muted">{d.allocation.uncovered ? `${num(d.allocation.uncovered)} t still uncovered` : "Demand fully covered"}</div></div>
      </div>
      {d.allocation.single_source_risk && <p className="mt-3 text-sm text-amber flex items-center gap-1.5"><AlertTriangle size={15} /> Single-source risk: only one qualified supplier. Qualify a backup before committing volumes.</p>}
      <div className="overflow-x-auto mt-4 border border-border rounded-md">
        <table className="table min-w-[860px]">
          <thead><tr><th>Source</th><th>Qualification</th><th className="text-right">Capacity</th><th className="text-right">Allocated</th><th className="text-right">Landed ₹/usable t</th><th className="text-right">Distance</th><th className="text-right">Quality fit</th><th className="text-right">CO2 t/t</th><th>Data</th></tr></thead>
          <tbody>
            {d.options.map((o) => (
              <tr key={o.id} className={o.is_primary ? "bg-emerald-soft/40" : ""}>
                <td><div className="font-medium flex items-center gap-1">{o.supplier.hidden && <Lock size={12} />}{o.match_id ? <Link to={`/match/${o.match_id}`} className="hover:underline">{o.supplier.name}</Link> : o.supplier.name}{o.is_primary && <span className="chip bg-emerald text-white ml-1">Current</span>}</div>
                  <div className="text-xs text-muted">{o.material}</div></td>
                <td><span className={`text-xs font-medium ${o.eligibility === "eligible" ? "text-emerald" : o.eligibility === "conditional" ? "text-amber" : "text-danger"}`}>{EL[o.eligibility]}</span>
                  <div className="text-[11px] text-muted">{o.qualified ? "Qualified" : "Needs qualification"} · evidence {Math.round(o.evidence_completeness * 100)}%</div></td>
                <td className="text-right tabular-nums">{num(o.capacity)}</td>
                <td className="text-right tabular-nums font-medium">{plan.has(o.id) ? num(plan.get(o.id)!) : "-"}</td>
                <td className="text-right tabular-nums">{o.cost != null ? inr(o.cost) : "-"}</td>
                <td className="text-right tabular-nums">{num(o.distance_km)} km</td>
                <td className="text-right tabular-nums">{Math.round(o.technical_fit * 100)}%</td>
                <td className="text-right tabular-nums">{o.co2_per_tonne.toFixed(2)}</td>
                <td><TrustBadge trust={o.trust} small /><div className="text-[11px] text-muted mt-0.5">{o.freshness === "fresh" ? "Current" : o.freshness === "stale" ? "Stale" : "Unconfirmed"} · reliability {o.reliability.replace("_", " ")}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted mt-2">{d.note}</p>
    </div>
  );
}
