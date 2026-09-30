import { CheckCircle2, CircleDashed, HelpCircle, ShieldCheck, Sparkles, Wrench, XCircle } from "lucide-react";
import type { PropStatus, Trust } from "../../types";

const TRUST: Record<string, { label: string; cls: string; icon: typeof Sparkles }> = {
  verified: { label: "VERIFIED", cls: "bg-emerald-soft text-emerald border-emerald/30", icon: ShieldCheck },
  user_declared: { label: "USER DECLARED", cls: "bg-sky/10 text-sky border-sky/30", icon: CheckCircle2 },
  ai_inferred: { label: "AI INFERRED", cls: "bg-amber/10 text-amber border-amber/30", icon: Sparkles },
  requires_evidence: { label: "REQUIRES EVIDENCE", cls: "bg-danger/10 text-danger border-danger/30", icon: CircleDashed },
};

export function TrustBadge({ trust, small = false }: { trust: Trust | string; small?: boolean }) {
  const t = TRUST[trust] ?? TRUST.ai_inferred;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border font-semibold tracking-wide ${small ? "px-1.5 py-0 text-[9px]" : "px-2 py-0.5 text-[10px]"} ${t.cls}`}
      title={trust === "ai_inferred" ? "Estimated from industry type and capacity. Not confirmed by the company." : undefined}>
      <t.icon size={small ? 9 : 11} />{t.label}
    </span>
  );
}

export function RequiresEvidence() {
  return <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide bg-danger/5 text-danger border-danger/25"><CircleDashed size={11} />REQUIRES EVIDENCE</span>;
}

const SRC: Record<string, [string, string]> = {
  lab_verified: ["Lab verified", "text-emerald"], document_reported: ["Document", "text-sky"], user_reported: ["User reported", "text-sky"],
  ai_inferred: ["AI inferred", "text-amber"], unknown: ["Unknown", "text-muted"],
};
export function SourceTag({ source }: { source: string }) {
  const [l, c] = SRC[source] ?? [source, "text-muted"];
  return <span className={`text-[11px] font-medium ${c}`}>{l}</span>;
}

const PS: Record<PropStatus, { cls: string; icon: typeof CheckCircle2 }> = {
  PASS: { cls: "text-emerald bg-emerald-soft", icon: CheckCircle2 }, FAIL: { cls: "text-danger bg-danger/10", icon: XCircle },
  FIXABLE: { cls: "text-sky bg-sky/10", icon: Wrench }, UNKNOWN: { cls: "text-amber bg-amber/10", icon: HelpCircle },
};
export function PropStatusBadge({ status }: { status: PropStatus }) {
  const p = PS[status];
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${p.cls}`}><p.icon size={12} />{status}</span>;
}

export const BASIS_CLS: Record<string, string> = {
  ESTIMATE: "text-amber border-amber/30 bg-amber/5", "USER PROVIDED": "text-sky border-sky/30 bg-sky/5", VERIFIED: "text-emerald border-emerald/30 bg-emerald-soft",
};
export function BasisTag({ basis }: { basis: string }) {
  return <span className={`rounded border px-1 text-[9px] font-semibold tracking-wide ${BASIS_CLS[basis] ?? "text-muted border-border"}`}>{basis}</span>;
}
