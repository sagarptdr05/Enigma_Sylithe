import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, ImageIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader, { AppPage, Segmented } from "../components/layout/AppHeader";
import { Skeleton } from "../components/cards/Feedback";
import { PhotoCard, PhotoUploader, TraitChips, VisualResults } from "../components/photos/Photo";
import { apiError, deletePhoto, photoSearch, useIndustry, useRequirementPhotos, useVisualMatches } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { PhotoSearch } from "../types";

type Mode = "requirement" | "search";

function RequirementMode() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const ind = useIndustry(auth.user?.industry ? String(auth.user.industry.id) : undefined);
  const demands = ind.data?.demands ?? [];
  const did = Number(params.get("demand")) || demands.find((d) => d.material === "Mineral gypsum")?.id || demands[0]?.id || null;
  const photos = useRequirementPhotos(did);
  const vm = useVisualMatches(did, !!photos.data?.length);
  if (!auth.user?.industry) return <div className="card p-6 text-sm">Log in as a buying plant to match your requirement photos. You can still <button className="btn-link" onClick={() => setParams({ mode: "search" })}>search with any photo</button>.</div>;
  if (ind.isLoading) return <Skeleton className="h-64" />;
  const cur = demands.find((d) => d.id === did);
  return (
    <div className="grid xl:grid-cols-[340px_1fr] gap-6">
      <aside className="space-y-4">
        <section className="card p-4">
          <div className="section-title">Your requirement</div>
          <select className="input mt-2" value={did ?? ""} onChange={(e) => setParams({ mode: "requirement", demand: e.target.value })}>
            {demands.map((d) => <option key={d.id} value={d.id}>{d.material}</option>)}
          </select>
          {cur && <div className="text-xs text-muted mt-2">{Math.round(cur.monthly_tonnes).toLocaleString("en-IN")}/month · spec {Object.entries(cur.spec).map(([k, [a, b]]) => `${k.replace("_pct", "")} ${a}-${b}`).join(", ") || "none"}</div>}
        </section>
        <section className="card p-4 space-y-3">
          <div className="section-title">Reference photos</div>
          <p className="text-xs text-muted">A photo of the material you use today. Suppliers' photos are compared with it.</p>
          {did && <PhotoUploader path={`/demands/${did}/images`} label="Add photo" onUploaded={() => { qc.invalidateQueries({ queryKey: ["photos"] }); qc.invalidateQueries({ queryKey: ["visual"] }); }} />}
          {photos.data?.map((p) => <PhotoCard key={p.id} p={p} onDelete={() => deletePhoto(p.id).then(() => { qc.invalidateQueries({ queryKey: ["photos"] }); qc.invalidateQueries({ queryKey: ["visual"] }); })} />)}
        </section>
      </aside>
      <section className="card p-5 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div><div className="section-title">Suppliers whose material looks like yours</div>
            <p className="section-sub">Ranked by specification fit ({Math.round((vm.data?.weights.specification ?? 0.65) * 100)}%) and visual similarity ({Math.round((vm.data?.weights.visual ?? 0.35) * 100)}%). Photos never qualify a material on their own.</p></div>
          {vm.data && <span className="chip bg-subtle border border-border !text-xs">{vm.data.method}</span>}
        </div>
        {!photos.data?.length ? <div className="text-sm text-muted flex items-center gap-2"><ImageIcon size={16} /> Add a reference photo to start.</div>
          : vm.isLoading ? <Skeleton className="h-64" /> : vm.error ? <p className="text-sm text-danger">{apiError(vm.error)}</p>
          : vm.data && <VisualResults results={vm.data.results} referenceTraits={photos.data[0].traits} />}
        {vm.data && <p className="text-[11px] text-muted mt-3">{vm.data.note}</p>}
      </section>
    </div>
  );
}

function SearchMode() {
  const auth = useAuth();
  const ref = useRef<HTMLInputElement>(null);
  const ind = useIndustry(auth.user?.industry ? String(auth.user.industry.id) : undefined);
  const [demand, setDemand] = useState<string>("");
  const [res, setRes] = useState<PhotoSearch | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (f?: File) => {
    if (!f) return;
    setPreview(URL.createObjectURL(f)); setBusy(true); setErr("");
    try { setRes(await photoSearch(f, demand ? +demand : null)); } catch (e) { setErr(apiError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="grid xl:grid-cols-[340px_1fr] gap-6">
      <aside className="card p-4 space-y-3 h-fit">
        <div className="section-title">Search with a photo</div>
        <p className="text-xs text-muted">Photograph a material (a sample, a stockpile, what you buy today). Sylithex describes it, suggests what it is, and finds listed materials that look alike.</p>
        {ind.data && <label className="block"><span className="label">Check against my requirement (optional)</span>
          <select className="input mt-1" value={demand} onChange={(e) => setDemand(e.target.value)}><option value="">No, just find similar listings</option>
            {ind.data.demands.map((d) => <option key={d.id} value={d.id}>{d.material}</option>)}</select></label>}
        <button className="btn-primary w-full" disabled={busy} onClick={() => ref.current?.click()} data-demo="photo-search"><Camera size={15} /> {busy ? "Analysing photo…" : "Choose a photo"}</button>
        <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => run(e.target.files?.[0])} />
        {preview && <img src={preview} alt="Your photo" className="rounded-md border border-border w-full aspect-[4/3] object-cover" />}
        {err && <p className="text-xs text-danger">{err}</p>}
        <p className="text-[11px] text-muted">The photo is analysed and discarded, not stored.</p>
      </aside>
      <section className="card p-5 min-w-0">
        {!res ? <p className="text-sm text-muted">Results appear here.</p> : <>
          <div className="grid md:grid-cols-2 gap-5">
            <div><div className="section-title mb-2">What the photo shows</div><TraitChips t={res.traits} />
              <p className="text-xs text-muted mt-2">Indicative appearance only; composition needs a lab test.</p></div>
            <div><div className="section-title mb-2">It most resembles</div>
              {res.predicted.length ? <ul className="text-sm space-y-1">{res.predicted.map((p) => <li key={p.material} className="flex justify-between"><span>{p.material}</span><span className="tabular-nums text-muted">{Math.round(p.score * 100)}%</span></li>)}</ul> : <p className="text-sm text-muted">Not enough labelled photos yet.</p>}
              <p className="text-[11px] text-muted mt-1">{res.identification}</p>
              {res.predicted[0] && <Link to={`/discover?current=${encodeURIComponent(res.predicted[0].material)}&use=${encodeURIComponent("find buyers or substitutes")}&qty=500`} className="btn-link text-xs mt-2 inline-block">Explore {res.predicted[0].material} in Discover →</Link>}</div>
          </div>
          <div className="section-title mt-6 mb-3">{res.demand ? `Listed materials for your ${res.demand.material} requirement` : "Listed materials that look alike"}</div>
          <VisualResults results={res.similar} referenceTraits={res.traits} />
          <p className="text-[11px] text-muted mt-3">{res.note}</p>
        </>}
      </section>
    </div>
  );
}

export default function PhotoMatch() {
  const [params, setParams] = useSearchParams();
  const mode = (params.get("mode") as Mode) ?? "requirement";
  return (
    <AppPage header={<AppHeader eyebrow="Source & evaluate / Photo match" title="Match materials by photo"
      description="Producers add photos of their by-products; buyers add a photo of the material they need. Sylithex compares colour, texture and appearance (with CLIP image recognition when available) and combines it with the specification check, so a similar-looking material never replaces a lab test."
      right={<Segmented value={mode} onChange={(m) => setParams({ mode: m })} options={[{ value: "requirement", label: "My requirement photos" }, { value: "search", label: "Search with any photo" }]} />} />}>
      {mode === "requirement" ? <RequirementMode /> : <SearchMode />}
    </AppPage>
  );
}
