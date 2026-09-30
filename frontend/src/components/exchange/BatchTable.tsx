import type { BatchRow } from "../../types";
import { num } from "../../lib/format";
import { PropStatusBadge } from "../cards/Badges";

const ST: Record<string, string> = { in_transit: "bg-sky-soft text-sky", received: "bg-subtle text-ink", accepted: "bg-emerald-soft text-emerald", partial: "bg-amber-soft text-amber", rejected: "bg-danger-soft text-danger" };

export default function BatchTable({ batches, unit }: { batches: BatchRow[]; unit: string }) {
  if (!batches.length) return <p className="text-sm text-muted">No batches dispatched yet. Each dispatch creates a traceable batch record.</p>;
  return (
    <div className="space-y-3" data-demo="batches">
      {batches.map((b) => (
        <div key={b.id} className="border border-border rounded-md">
          <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm border-b border-border bg-subtle/60">
            <span className="font-semibold">{b.batch_code}</span>
            <span className={`chip ${ST[b.status] ?? "bg-subtle"}`}>{b.status.replace("_", " ")}</span>
            <span className="text-muted text-xs">Dispatched {new Date(b.dispatched_at).toLocaleDateString("en-IN")}{b.manifest_ref ? ` · manifest ${b.manifest_ref}` : ""}{b.promised_date ? ` · promised ${b.promised_date}` : ""}</span>
          </div>
          <div className="px-3 py-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><div className="text-[11px] text-muted">Dispatched</div><div className="tabular-nums">{num(b.dispatched_tonnes)} {unit}</div></div>
            <div><div className="text-[11px] text-muted">Received</div><div className="tabular-nums">{b.received_tonnes != null ? `${num(b.received_tonnes)} ${unit}` : "-"}</div></div>
            <div><div className="text-[11px] text-muted">Accepted</div><div className="tabular-nums text-emerald font-medium">{b.accepted_tonnes != null ? `${num(b.accepted_tonnes)} ${unit}` : "-"}</div></div>
            <div><div className="text-[11px] text-muted">Rejected</div><div className={`tabular-nums ${b.rejected_tonnes ? "text-danger font-medium" : ""}`}>{b.rejected_tonnes != null ? `${num(b.rejected_tonnes)} ${unit}` : "-"}</div></div>
          </div>
          {b.checks.length > 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-2 text-xs">
              <span className="text-muted">Batch test {b.test_date}:</span>
              {b.checks.map((c) => <span key={c.property} className="inline-flex items-center gap-1">{c.label} {c.actual} <PropStatusBadge status={c.status} /></span>)}
            </div>
          )}
          {(b.rejection_reason || b.corrective_action) && (
            <div className="px-3 pb-2 text-xs"><span className="text-danger font-medium">Deviation:</span> {b.rejection_reason}{b.corrective_action && <> · <span className="text-sky font-medium">Corrective action:</span> {b.corrective_action}</>}</div>
          )}
        </div>
      ))}
    </div>
  );
}
