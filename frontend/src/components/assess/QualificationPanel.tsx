import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { Qualification } from "../../types";

const EL = {
  eligible: ["bg-emerald-soft border-emerald/30 text-emerald", CheckCircle2],
  conditional: ["bg-amber-soft border-amber/30 text-amber", AlertTriangle],
  not_eligible: ["bg-danger-soft border-danger/30 text-danger", XCircle],
} as const;
const DOC_CLS: Record<string, string> = {
  accepted: "text-emerald", under_review: "text-sky", rejected: "text-danger", expired: "text-danger", revalidation_required: "text-amber",
};

export function EligibilityBanner({ e }: { e: Qualification["eligibility"] }) {
  const [cls, Icon] = EL[e.status];
  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`} data-demo="eligibility">
      <div className="flex items-center gap-2 font-semibold text-sm"><Icon size={16} /> {e.label}
        <span className="font-normal text-xs text-muted ml-1">decided by specification and gate checks, not by the score</span></div>
      {e.reasons.length > 0 && <ul className="mt-1.5 text-[13px] text-ink/80 space-y-0.5 list-disc pl-5">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}

export function FactorTable({ f }: { f: Qualification["factors"] }) {
  return (
    <div>
      <table className="table">
        <thead><tr><th>Factor</th><th className="text-right">Value</th><th className="text-right">Weight</th><th className="text-right">Contribution</th><th className="hidden md:table-cell">How it is calculated</th></tr></thead>
        <tbody>
          {f.factors.map((r) => (
            <tr key={r.factor}>
              <td className="font-medium">{r.factor}</td>
              <td className="text-right tabular-nums">{r.value.toFixed(0)}</td>
              <td className="text-right tabular-nums text-muted">{r.weight}%</td>
              <td className="text-right tabular-nums font-medium">{r.contribution.toFixed(1)}</td>
              <td className="hidden md:table-cell text-xs text-muted">{r.method}</td>
            </tr>
          ))}
          <tr><td className="font-medium">Ranking score</td><td /><td /><td className="text-right tabular-nums font-semibold">{f.score.toFixed(1)}</td>
            <td className="hidden md:table-cell text-xs text-muted">{f.hazard_penalty ? `Raw ${f.raw_score.toFixed(1)} × ${f.hazard_penalty} hazardous-material penalty` : "Sum of contributions"}</td></tr>
        </tbody>
      </table>
      <p className="text-xs text-muted mt-2">{f.note}</p>
    </div>
  );
}

export function EvidenceStates({ docs, latest }: { docs: Qualification["evidence_documents"]; latest: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted mb-2">Latest test on record: <b className="text-ink">{latest ?? "none"}</b></div>
      {docs.length ? (
        <ul className="divide-y divide-border border border-border rounded-md">
          {docs.map((d) => (
            <li key={d.id} className="px-3 py-2 text-sm flex items-start justify-between gap-3">
              <span className="min-w-0"><span className="font-medium">{d.title}</span>
                <span className="block text-xs text-muted">{[d.issuer, d.issue_date && `issued ${d.issue_date}`, d.expiry_date && `expires ${d.expiry_date}`].filter(Boolean).join(" · ") || "No issuer / date given"}</span></span>
              <span className={`text-xs font-medium whitespace-nowrap ${DOC_CLS[d.state] ?? "text-muted"}`}>{d.label}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted flex items-center gap-1.5"><CircleDashed size={14} /> No documents provided yet.</p>}
      <p className="text-[11px] text-muted mt-2">An uploaded file is not proof of authenticity or legal compliance. “Accepted” means a facilitator reviewed it for the stated purpose.</p>
    </div>
  );
}
