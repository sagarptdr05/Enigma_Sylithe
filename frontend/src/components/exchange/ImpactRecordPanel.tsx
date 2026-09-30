import { ShieldCheck } from "lucide-react";
import type { ImpactRecordData, NetBenefit } from "../../types";
import { inr, num } from "../../lib/format";

function Col({ title, n, accent }: { title: string; n: NetBenefit; accent: string }) {
  return (
    <div className="rounded-lg border border-border p-3" style={{ borderTop: `3px solid ${accent}` }}>
      <div className="text-sm font-semibold">{title}</div>
      {n.status === "ok" ? (
        <dl className="mt-2 text-sm space-y-1">
          <div className="flex justify-between"><dt className="text-muted">Quantity</dt><dd className="tabular-nums">{num(n.tonnes ?? 0)} t</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Virgin production avoided</dt><dd className="tabular-nums">{num(n.baseline_avoided ?? 0)} tCO2</dd></div>
          <div className="flex justify-between"><dt className="text-muted">− Transport</dt><dd className="tabular-nums">{n.transport_emissions} tCO2</dd></div>
          <div className="flex justify-between"><dt className="text-muted">− Processing</dt><dd className="tabular-nums">{n.processing_emissions} tCO2</dd></div>
          <div className="flex justify-between font-semibold border-t border-border pt-1"><dt>Net</dt><dd className="tabular-nums">{num(n.net_tco2 ?? 0)} tCO2</dd></div>
        </dl>
      ) : <p className="text-sm text-muted mt-2">{n.label ?? "Insufficient data to calculate"}</p>}
      <p className="text-[11px] text-muted mt-2">{n.basis}</p>
    </div>
  );
}

export default function ImpactRecordPanel({ r, canVerify, canRecordUse, onVerify, onRecordUse }: {
  r: ImpactRecordData; canVerify: boolean; canRecordUse: boolean; onVerify: () => void; onRecordUse: (t: number) => void;
}) {
  return (
    <div data-demo="impact-record">
      <div className="grid md:grid-cols-3 gap-3">
        <Col title="Pre-exchange estimate" n={r.estimate} accent="#94A3B8" />
        <Col title="Reported after delivery" n={r.reported} accent="#0369A1" />
        <div className="rounded-lg border border-border p-3" style={{ borderTop: "3px solid #15803D" }}>
          <div className="text-sm font-semibold">Independently verified</div>
          {r.verified.status === "verified" ? <p className="text-sm mt-2 flex items-center gap-1.5 text-emerald"><ShieldCheck size={15} /> Verified by {r.verified.by}</p>
            : <p className="text-sm text-muted mt-2">Not independently verified yet.</p>}
          <p className="text-[11px] text-muted mt-2">{r.verified.basis}</p>
          {canVerify && <button className="btn-green !h-8 mt-3 text-xs" onClick={onVerify}>Verify against delivery records</button>}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-4 text-sm">
        <div>
          <div className="kv"><span>Accepted quantity</span><span className="tabular-nums">{r.accepted_tonnes != null ? `${num(r.accepted_tonnes)} t` : "-"}</span></div>
          <div className="kv"><span>Used in production</span><span className="tabular-nums">{r.used_tonnes != null ? `${num(r.used_tonnes)} t` : "Not recorded"}</span></div>
          <div className="kv"><span>Estimated value of accepted material</span><span className="tabular-nums">{r.saving_estimate != null ? inr(r.saving_estimate) : "-"}</span></div>
          {canRecordUse && <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); const v = +(new FormData(e.currentTarget).get("t") as string); if (v > 0) onRecordUse(v); }}>
            <input name="t" type="number" className="input !h-8" placeholder="Tonnes used in production" /><button className="btn-primary !h-8 text-xs">Record use</button></form>}
        </div>
        <div className="text-xs text-muted space-y-1">
          <div><b className="text-ink">Boundary:</b> {r.boundary}</div>
          {Object.entries(r.factors).map(([k, f]) => <div key={k}><b className="text-ink">{k.replace("_", " ")}:</b> {f.value != null ? `${f.value} ` : ""}{f.unit} · {f.source} ({f.date})</div>)}
          <div>{r.note}</div>
        </div>
      </div>
    </div>
  );
}
