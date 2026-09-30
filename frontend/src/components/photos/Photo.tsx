import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, CheckCircle2, Lock, Trash2, XCircle } from "lucide-react";
import { api, apiError } from "../../api/client";
import { inr } from "../../lib/format";
import type { MaterialPhoto, PhotoTraits, VisualResult } from "../../types";

export const photoUrl = (p: { url: string }) => `${(api.defaults.baseURL ?? "").replace(/\/api$/, "")}${p.url}`;

export function TraitChips({ t }: { t: PhotoTraits }) {
  return (
    <div className="flex flex-wrap gap-1">
      <span className="chip bg-subtle border border-border"><span className="h-2.5 w-2.5 rounded-full border border-border" style={{ background: `rgb(${t.mean_rgb.join(",")})` }} />{t.colour}</span>
      <span className="chip bg-subtle border border-border">{t.texture}</span>
      <span className="chip bg-subtle border border-border">{t.moisture_look}</span>
    </div>
  );
}

export function PhotoCard({ p, onDelete }: { p: MaterialPhoto; onDelete?: () => Promise<unknown> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const remove = async () => {
    if (!onDelete) return;
    setBusy(true); setErr("");
    try { await onDelete(); } catch (e) { setErr(apiError(e)); setBusy(false); setConfirm(false); }
  };
  return (
    <figure className="rounded-lg border border-border overflow-hidden bg-surface">
      <div className="relative aspect-[4/3] bg-subtle">
        <img src={photoUrl(p)} alt={p.caption ?? "Material photo"} className="h-full w-full object-cover" loading="lazy" />
        {p.synthetic && <span className="absolute top-2 left-2 chip bg-surface/90 border border-border text-muted">Sample (synthetic)</span>}
      </div>
      <figcaption className="p-2.5 space-y-1.5">
        {p.caption && <div className="text-xs text-muted">{p.caption}</div>}
        <TraitChips t={p.traits} />
        {p.predicted?.length > 0 && <div className="text-[11px] text-muted">Looks like: {p.predicted.slice(0, 2).map((x) => `${x.material} ${Math.round(x.score * 100)}%`).join(", ")}</div>}
        {onDelete && (
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border text-xs">
            {confirm ? (
              <>
                <span className="text-muted mr-auto">Remove this photo?</span>
                <button className="btn-link text-xs" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
                <button className="inline-flex items-center gap-1 font-medium text-danger hover:underline" disabled={busy} onClick={remove}><Trash2 size={13} /> {busy ? "Removing…" : "Remove"}</button>
              </>
            ) : (
              <button className="inline-flex items-center gap-1 text-muted hover:text-danger" onClick={() => setConfirm(true)}><Trash2 size={13} /> Remove photo</button>
            )}
          </div>
        )}
        {err && <p className="text-xs text-danger">{err}</p>}
      </figcaption>
    </figure>
  );
}

export function PhotoUploader({ path, label, onUploaded }: { path: string; label: string; onUploaded: (p: MaterialPhoto) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [caption, setCaption] = useState("");
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", f); if (caption) fd.append("caption", caption);
      onUploaded((await api.post<MaterialPhoto>(path, fd)).data); setCaption("");
    } catch (e) { setErr(apiError(e)); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <div className="rounded-lg border border-dashed border-border p-3 bg-subtle/50" data-demo="photo-upload">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input !h-8 flex-1 min-w-[180px]" placeholder="Caption (optional), e.g. stockpile, dried sample" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <button className="btn-primary !h-8" disabled={busy} onClick={() => ref.current?.click()}><Camera size={14} /> {busy ? "Analysing…" : label}</button>
        <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <p className="text-[11px] text-muted mt-1.5">JPG, PNG or WEBP up to 5 MB. Location metadata (EXIF/GPS) is removed before storage.</p>
      {err && <p className="text-xs text-danger mt-1">{err}</p>}
    </div>
  );
}

const EL: Record<string, [string, string]> = { eligible: ["Meets specification", "text-emerald"], conditional: ["Specification fits, conditions open", "text-amber"], not_eligible: ["Specification fails", "text-danger"] };

export function VisualResults({ results, referenceTraits }: { results: VisualResult[]; referenceTraits?: PhotoTraits }) {
  if (!results.length) return <p className="text-sm text-muted">No supplier has added photos yet.</p>;
  return (
    <div className="space-y-3" data-demo="visual-results">
      {results.map((r) => {
        const [elLabel, elCls] = r.eligibility ? EL[r.eligibility] : r.spec_checked === false ? ["Not checked against a specification", "text-muted"] : ["Not compatible with this specification", "text-muted"];
        const pct = Math.round(r.visual.overall * 100);
        return (
          <div key={r.waste_stream_id} className={`rounded-lg border border-border bg-surface grid sm:grid-cols-[150px_1fr] overflow-hidden ${r.compatible ? "" : "opacity-80"}`}>
            <div className="relative bg-subtle aspect-[4/3] sm:aspect-auto"><img src={photoUrl(r.image)} alt={r.material} className="h-full w-full object-cover" loading="lazy" />
              {r.image.synthetic && <span className="absolute bottom-1.5 left-1.5 chip bg-surface/90 border border-border text-muted">synthetic</span>}</div>
            <div className="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="font-medium flex items-center gap-1.5">{r.material} <span className="text-muted font-normal text-sm flex items-center gap-1">· {r.supplier.hidden && <Lock size={12} />}{r.supplier.name}</span></div>
                  <div className={`text-xs font-medium mt-0.5 flex items-center gap-1 ${elCls}`}>{r.compatible ? <CheckCircle2 size={13} /> : r.spec_checked === false ? null : <XCircle size={13} />}{elLabel}</div></div>
                <div className="text-right"><div className="text-xs text-muted">Looks alike</div><div className="text-lg font-semibold tabular-nums">{pct}%</div></div>
              </div>
              <div className="h-1.5 bg-subtle rounded-full mt-2 overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
              {referenceTraits && <table className="w-full text-xs mt-3"><thead><tr className="text-muted text-left"><th className="font-medium py-0.5">Trait</th><th className="font-medium">Your photo</th><th className="font-medium">Their photo</th></tr></thead>
                <tbody>{r.traits.map((t) => <tr key={t.trait}><td className="py-0.5 text-muted">{t.trait}</td><td>{String(t.yours ?? "-")}</td><td className={t.same ? "text-emerald" : "text-amber"}>{String(t.theirs ?? "-")}</td></tr>)}</tbody></table>}
              <p className="text-[13px] mt-2">{r.conclusion}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted">
                {r.distance_km != null && <span>{Math.round(r.distance_km)} km</span>}
                {r.landed_cost_per_usable_tonne != null && <span>Landed {inr(r.landed_cost_per_usable_tonne)}/usable t</span>}
                {r.match_score != null && <span>Ranking score {Math.round(r.match_score)}</span>}
                <span>{r.visual.method}</span>
                <Link to={`/material/${r.waste_stream_id}`} className="btn-link text-xs">Passport</Link>
                {r.match_id && <Link to={`/match/${r.match_id}`} className="btn-link text-xs">Match analysis</Link>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
