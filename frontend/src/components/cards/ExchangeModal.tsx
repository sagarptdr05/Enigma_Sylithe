import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, X } from "lucide-react";
import { api, apiError, useApiMutation } from "../../api/client";
import { num } from "../../lib/format";
import type { Exchange } from "../../types";

const OPTIONAL = [["evidence", "Evidence review"], ["assessment", "Technical assessment"], ["sample", "Sample test"], ["trial", "Plant trial"]] as const;

/** Express interest / send an offer: opens an Exchange at the INTEREST stage. */
export default function ExchangeModal({ matchId, selling, counterparty, material, unit, suggestedTonnes, hazardous, onClose }: {
  matchId: number; selling: boolean; counterparty: string; material: string; unit: string; suggestedTonnes: number; hazardous?: boolean; onClose: () => void;
}) {
  const nav = useNavigate();
  const [tonnes, setTonnes] = useState(Math.round(suggestedTonnes));
  const [price, setPrice] = useState("");
  const [reveal, setReveal] = useState(true);
  const [stages, setStages] = useState<string[]>(["evidence", "assessment"]);
  const [msg, setMsg] = useState(selling ? `We can supply ~${num(suggestedTonnes)} ${unit}/month of ${material}. Interested in a trial?` : `We would like to evaluate your ${material} as a substitute. Can you share a lab report?`);
  const send = useApiMutation((b: object) => api.post<Exchange>("/exchanges", b).then((r) => r.data), [["exchanges"], ["assessment"]]);
  const submit = () => send.mutate({ match_id: matchId, monthly_tonnes: tonnes, price_per_tonne: price ? +price : undefined, message: msg, reveal_identity: reveal, include_stages: stages },
    { onSuccess: (x) => nav(`/exchange/${(x as Exchange).id}`) });
  return (
    <div className="fixed inset-0 z-[3000] bg-brand/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 relative max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <button className="absolute top-4 right-4 text-muted hover:text-ink" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="label text-emerald">{selling ? "Offer to buyer" : "Express interest"}</div>
        <h3 className="text-xl font-semibold mt-1">{counterparty}</h3>
        <p className="text-sm text-muted">{material}</p>
        <div className="grid grid-cols-2 gap-3 mt-5">
          <label><div className="label mb-1">Quantity ({unit}/month)</div><input className="input" type="number" min={1} value={tonnes} onChange={(e) => setTonnes(+e.target.value)} /></label>
          <label><div className="label mb-1">Indicative price ₹/{unit}</div><input className="input" type="number" min={0} value={price} placeholder="Negotiable" onChange={(e) => setPrice(e.target.value)} /></label>
        </div>
        <label className="block mt-3"><div className="label mb-1">Message</div><textarea className="input min-h-24" value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
        <div className="mt-4">
          <div className="label mb-2">Steps before negotiation (optional)</div>
          <div className="grid grid-cols-2 gap-2">
            {OPTIONAL.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stages.includes(k)} onChange={(e) => setStages(e.target.checked ? [...stages, k] : stages.filter((x) => x !== k))} className="accent-emerald" />{l}</label>
            ))}
          </div>
          <p className="text-xs text-muted mt-1">Negotiation, agreement, dispatch, receipt and acceptance always follow.</p>
        </div>
        <label className="flex items-start gap-2 text-sm mt-4 rounded-lg bg-bg p-3">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="accent-emerald mt-0.5" />
          <span><b>Reveal my identity if the other side agrees.</b> <span className="text-muted">Names and contacts are shared only when both parties consent.</span></span>
        </label>
        {hazardous && <p className="text-xs text-danger mt-2">Hazardous material: MPCB authorisation and manifests are required before dispatch.</p>}
        {send.isError && <p className="text-sm text-danger mt-3">{apiError(send.error)}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={send.isPending || tonnes <= 0} onClick={submit}><Send size={15} /> {send.isPending ? "Sending…" : selling ? "Send offer" : "Express interest"}</button>
        </div>
        <p className="text-[11px] text-muted mt-3">Nothing is binding until both parties sign the agreement.</p>
      </div>
    </div>
  );
}
