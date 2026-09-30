import { AlertTriangle, CheckCircle2, CircleDashed, ShieldCheck, XCircle } from "lucide-react";
import type { Assessment } from "../../types";

const G = { ok: [CheckCircle2, "text-emerald"], warn: [AlertTriangle, "text-amber"], fail: [XCircle, "text-danger"] } as const;
const OWNER: Record<string, string> = { supplier: "Supplier", buyer: "Buyer", both: "Both parties", either: "Either party" };

/** "What is stopping this opportunity from becoming a real exchange?" */
export function ReadinessPanel({ a, compact = false }: { a: Pick<Assessment, "gates" | "readiness" | "evidence">; compact?: boolean }) {
  const mb = a.readiness.main_blocker;
  return (
    <div className="space-y-4">
      <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"} gap-2`}>
        {a.gates.map((g) => {
          const [Icon, cls] = G[g.status];
          return (
            <div key={g.key} className="rounded-lg border border-border bg-bg/60 px-3 py-2" title={g.text}>
              <div className="flex items-center justify-between text-xs font-medium">{g.label}<Icon size={15} className={cls} /></div>
              {!compact && <div className="text-[11px] text-muted mt-0.5 line-clamp-2">{g.text}</div>}
            </div>
          );
        })}
      </div>
      {mb ? (
        <div className={`rounded-lg border p-4 ${mb.severity === "fail" ? "border-danger/40 bg-danger/5" : "border-amber/40 bg-amber/5"}`}>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted">Main blocker</div>
          <p className="font-medium mt-1">{mb.text}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
            <span><span className="text-muted">Owner:</span> <b>{OWNER[mb.owner] ?? mb.owner}</b></span>
            {mb.action && <span><span className="text-muted">Action:</span> {mb.action}</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald/40 bg-emerald-soft/60 p-4 flex items-center gap-2 font-medium text-emerald"><ShieldCheck size={18} /> No open blockers: ready to exchange</div>
      )}
      <EvidenceBlock e={a.evidence} />
    </div>
  );
}

export function EvidenceBlock({ e }: { e: Assessment["evidence"] }) {
  const pct = Math.round(e.completeness * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm"><span className="font-medium">Evidence completeness</span><span className="font-semibold tabular-nums">{pct}%</span></div>
      <div className="h-2 rounded-full bg-border mt-1.5 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "#16A34A" : pct >= 60 ? "#0284C7" : "#D97706" }} /></div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {e.items.map((i) => (
          <li key={i.key} className="flex items-start gap-2">
            {i.status === "verified" ? <ShieldCheck size={15} className="text-emerald mt-0.5 shrink-0" /> : i.status === "provided" ? <CheckCircle2 size={15} className="text-sky mt-0.5 shrink-0" /> : <CircleDashed size={15} className="text-amber mt-0.5 shrink-0" />}
            <span className="flex-1">{i.label}{i.status === "provided" && <span className="text-xs text-muted"> · submitted, not yet verified</span>}
              {i.status === "missing" && i.action && <span className="block text-xs text-amber">Next: {i.action}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhyPanel({ why, concerns }: { why: string[]; concerns: string[] }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald mb-2">Why this match?</div>
        <ul className="space-y-1.5 text-sm">{why.map((w) => <li key={w} className="flex gap-2"><CheckCircle2 size={15} className="text-emerald mt-0.5 shrink-0" />{w}</li>)}
          {!why.length && <li className="text-muted">No positive factors.</li>}</ul>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-amber mb-2">Why not (yet)?</div>
        <ul className="space-y-1.5 text-sm">{concerns.map((c) => <li key={c} className="flex gap-2">{c.startsWith("✗") ? <XCircle size={15} className="text-danger mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="text-amber mt-0.5 shrink-0" />}{c.replace(/^[✗⚠] /, "")}</li>)}
          {!concerns.length && <li className="text-muted">Nothing blocking.</li>}</ul>
      </div>
    </div>
  );
}
