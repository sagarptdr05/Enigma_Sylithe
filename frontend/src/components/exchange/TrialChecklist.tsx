import { useState } from "react";
import { Check, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import type { ChecklistItemRow } from "../../types";

const KIND: Record<string, string> = { review: "Technical review", document: "Document", sample: "Sample", lab_test: "Lab test", production: "Production", trial: "Trial", decision: "Approval" };
const ST = { done: [Check, "text-emerald"], failed: [XCircle, "text-danger"], waived: [MinusCircle, "text-muted"], open: [CircleDashed, "text-amber"] } as const;

export default function TrialChecklist({ items, role, active, onUpdate }: {
  items: ChecklistItemRow[]; role: string | null; active: boolean; onUpdate: (id: number, status: string, text?: string) => void;
}) {
  const [note, setNote] = useState<Record<number, string>>({});
  const done = items.filter((i) => i.status === "done" || i.status === "waived").length;
  return (
    <div data-demo="checklist">
      <div className="flex items-center justify-between mb-3">
        <div><div className="section-title">Qualification & trial plan</div><div className="section-sub">Generated from the open specification gaps, missing evidence and processing needs.</div></div>
        <div className="text-sm tabular-nums"><b>{done}</b>/{items.length} complete</div>
      </div>
      <div className="h-1.5 bg-subtle rounded-full overflow-hidden mb-3"><div className="h-full bg-emerald" style={{ width: `${(done / Math.max(items.length, 1)) * 100}%` }} /></div>
      <ul className="divide-y divide-border border border-border rounded-md">
        {items.map((it) => {
          const [Icon, cls] = ST[it.status];
          const mine = active && (it.owner === role || it.owner === "both" || (it.kind === "decision" && role === "buyer"));
          return (
            <li key={it.id} className="px-3 py-2.5 flex flex-wrap items-start gap-3">
              <Icon size={16} className={`${cls} mt-0.5 shrink-0`} />
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-medium">{it.title}</div>
                <div className="text-xs text-muted">{KIND[it.kind] ?? it.kind} · owner: {it.owner}{it.due_date ? ` · due ${it.due_date}` : ""}{it.completed_by ? ` · ${it.status} by ${it.completed_by}` : ""}</div>
                {it.acceptance_criteria && <div className="text-xs text-ink/70 mt-0.5">Criteria: {it.acceptance_criteria}</div>}
                {it.notes && <div className="text-xs text-sky mt-0.5">Note: {it.notes}</div>}
              </div>
              {mine && it.status === "open" && (
                <div className="flex items-center gap-1.5">
                  <input className="input !h-7 !w-40 text-xs" placeholder="Note (optional)" value={note[it.id] ?? ""} onChange={(e) => setNote({ ...note, [it.id]: e.target.value })} />
                  <button className="btn-green !h-7 !px-2.5 text-xs" onClick={() => onUpdate(it.id, "done", note[it.id])}>{it.kind === "decision" ? "Approve" : "Done"}</button>
                  <button className="btn-ghost !h-7 !px-2.5 text-xs" onClick={() => onUpdate(it.id, "failed", note[it.id])}>Failed</button>
                  {it.kind !== "decision" && <button className="btn-ghost !h-7 !px-2.5 text-xs" onClick={() => onUpdate(it.id, "waived", note[it.id])}>Waive</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted mt-2">Sylithex never approves industrial use: the final approval is recorded by the buyer's authorised reviewer.</p>
    </div>
  );
}
