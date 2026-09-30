import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, MapPin, SlidersHorizontal, X } from "lucide-react";
import AppHeader, { AppPage, Segmented, StatStrip } from "../components/layout/AppHeader";
import ClusterMap, { type MapLink, type MapNode } from "../components/map/ClusterMap";
import MapLegend from "../components/map/MapLegend";
import ScorePill from "../components/cards/ScorePill";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { useClusters, useIndustries, useMatches } from "../api/client";
import { inr, num, unitFor } from "../lib/format";
import { metaFor } from "../lib/industryMeta";

const SHORT: Record<string, string> = { "Taloja MIDC": "Taloja", "Tarapur MIDC": "Tarapur", "Kolhapur Agro Belt": "Kolhapur", "Pune-Chakan Urban": "Pune-Chakan" };

export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  const clusters = useClusters();
  const cluster = params.get("cluster") ?? "Tarapur MIDC";
  const [type, setType] = useState("");
  const [minScore, setMinScore] = useState(70);
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [density, setDensity] = useState<"top" | "all">("top");
  const inds = useIndustries(cluster);
  const matches = useMatches({ cluster, min_score: minScore, limit: 400 });
  const kpi = clusters.data?.find((c) => c.name === cluster);

  const nodes = useMemo(() => (inds.data ?? []).filter((i) => !type || i.type === type), [inds.data, type]);
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const visible = useMemo(() => (matches.data ?? []).filter((m) =>
    nodeIds.has(m.src_id) && (nodeIds.has(m.dst_id) || !type) && m.buyer.cluster === cluster), [matches.data, nodeIds, type, cluster]);
  const links: MapLink[] = useMemo(() => {
    // one line per plant pair; in "key links" mode only each plant's 2 most valuable outgoing links (plus the selected plant's)
    const best = new Map<string, (typeof visible)[number]>();
    for (const m of [...visible].sort((a, b) => b.net_saving_per_year - a.net_saving_per_year)) {
      const k = `${m.src_id}-${m.dst_id}`;
      if (!best.has(k)) best.set(k, m);
    }
    const perSrc = new Map<number, number>();
    const out: MapLink[] = [];
    for (const [k, m] of best) {
      const involved = !!selected && (m.src_id === selected.id || m.dst_id === selected.id);
      const n = perSrc.get(m.src_id) ?? 0;
      if (density === "top" && n >= 2 && !involved) continue;
      perSrc.set(m.src_id, n + 1);
      out.push({ key: k, from: m.source, to: m.buyer, score: m.score, tonnes: m.tradable_tonnes, animate: involved,
        label: `${m.source.name} → ${m.buyer.name}: ${m.waste_name} (${Math.round(m.score)})`, dim: !!selected && !involved });
    }
    return out;
  }, [visible, selected, density]);
  const top = useMemo(() => [...visible].sort((a, b) => b.net_saving_per_year - a.net_saving_per_year).slice(0, 10), [visible]);
  const types = [...new Set((inds.data ?? []).map((i) => i.type))];
  const selInd = inds.data?.find((i) => i.id === selected?.id);
  const selMatches = selected ? visible.filter((m) => m.src_id === selected.id || m.dst_id === selected.id) : [];

  const header = (
    <AppHeader eyebrow="Cluster overview" title={cluster}
      description="Every plant in the cluster and the waste-to-resource exchanges Sylithex found between them. Each line means one plant's by-product can replace a raw material the other buys."
      right={clusters.data && <Segmented value={cluster} onChange={(c) => { setParams({ cluster: c }); setSelected(null); setType(""); }}
        options={clusters.data.map((c) => ({ value: c.name, label: SHORT[c.name] ?? c.name }))} />}>
      {kpi ? <StatStrip demo="kpis" stats={[
        { label: "Savings / year", value: kpi.saving_per_year, format: (n) => inr(n) },
        { label: "CO2 avoided / year", value: kpi.co2_per_year, format: (n) => `${num(n)} t` },
        { label: "Waste diverted / year", value: kpi.waste_diverted_per_year, format: (n) => `${num(n)} t` },
        { label: "Viable exchanges", value: kpi.matches, format: (n) => num(n) },
        { label: "Closed loops", value: kpi.loops, format: (n) => num(n) },
        { label: "Plants", value: kpi.industries, format: (n) => num(n) },
      ]} /> : <Skeleton className="h-20" />}
    </AppHeader>
  );

  return (
    <AppPage header={header}>
      <div className="grid xl:grid-cols-[1fr_420px] gap-5">
        <section className="card overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-border">
            <SlidersHorizontal size={16} className="text-muted" />
            <select className="input !w-auto !py-1.5" value={type} onChange={(e) => setType(e.target.value)} aria-label="Industry type">
              <option value="">All industry types</option>
              {types.map((t) => <option key={t} value={t}>{metaFor(t).label}</option>)}
            </select>
            <label className="flex items-center gap-3 text-sm text-muted">
              Min. feasibility <input type="range" min={40} max={95} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="w-32" />
              <span className="text-ink font-medium tabular-nums w-6">{minScore}</span>
            </label>
            <span className="ml-auto flex items-center gap-3 text-sm text-muted">{nodes.length} plants · {links.length} links
              <Segmented dark={false} value={density} onChange={setDensity} options={[{ value: "top", label: "Key links" }, { value: "all", label: "All links" }]} /></span>
          </div>
          <div className="relative p-3">
            {inds.error ? <ErrorState error={inds.error} onRetry={() => inds.refetch()} /> :
              inds.isLoading ? <Skeleton className="h-[600px]" /> :
                <ClusterMap nodes={nodes} links={links} onSelect={setSelected} selectedId={selected?.id} className="h-[600px]" />}
            {!inds.isLoading && <div className="absolute bottom-6 left-6 z-[500]"><MapLegend types={types} /></div>}
            {!selInd && !inds.isLoading && (
              <div className="absolute top-6 right-6 z-[500] rounded-lg bg-brand text-white text-xs px-3 py-2 shadow-soft">Click any plant to see its exchanges</div>
            )}
            <AnimatePresence>
              {selInd && (
                <motion.div initial={{ x: 20 }} animate={{ x: 0 }} exit={{ x: 20, opacity: 0 }}
                  className="absolute top-6 right-6 z-[500] w-80 max-w-[calc(100%-3rem)] card p-4 shadow-xl">
                  <button className="absolute top-3 right-3 text-muted hover:text-ink" onClick={() => setSelected(null)} aria-label="Close"><X size={16} /></button>
                  <div className="text-xs font-medium" style={{ color: metaFor(selInd.type).color }}>{metaFor(selInd.type).label}</div>
                  <h3 className="font-semibold mt-0.5 pr-6 leading-snug">{selInd.name}</h3>
                  <p className="text-xs text-muted mt-1 flex items-center gap-1"><MapPin size={11} />{selInd.address ?? selInd.cluster}</p>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-center">
                    <div className="rounded-lg bg-bg py-2"><div className="font-display font-semibold">{selInd.match_count}</div><div className="text-[10px] uppercase text-muted">exchanges</div></div>
                    <div className="rounded-lg bg-bg py-2"><div className="font-display font-semibold text-amber">{selInd.hidden_count}</div><div className="text-[10px] uppercase text-muted">hidden by-products</div></div>
                  </div>
                  <div className="mt-3 divide-y divide-border text-xs max-h-44 overflow-auto">
                    {selMatches.slice(0, 6).map((m) => (
                      <Link key={m.id} to={`/match/${m.id}`} className="flex justify-between gap-2 py-1.5 hover:text-brand">
                        <span className="truncate">{m.src_id === selInd.id ? `Sells ${m.waste_name} → ${m.buyer.name}` : `Buys ${m.waste_name} ← ${m.source.name}`}</span>
                        <span className="text-emerald font-medium shrink-0">{inr(m.net_saving_per_year)}</span>
                      </Link>
                    ))}
                  </div>
                  <Link to={`/industry/${selInd.id}`} className="btn-primary w-full mt-3">Open plant profile <ArrowRight size={14} /></Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        <aside className="card min-w-0 flex flex-col">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <h2 className="font-semibold text-lg">Top opportunities</h2>
            <p className="text-xs text-muted">Ranked by yearly value · feasibility ≥ {minScore}</p>
          </div>
          {matches.isLoading ? <div className="p-4"><Skeleton className="h-96" /></div> : matches.error ? <div className="p-4"><ErrorState error={matches.error} /></div> : (
            <ol className="divide-y divide-border flex-1">
              {top.map((m, i) => (
                <li key={m.id}>
                  <Link to={`/match/${m.id}`} className="flex gap-3 px-5 py-3 hover:bg-bg transition-colors">
                    <span className="text-muted tabular-nums text-sm w-5 pt-0.5">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{m.source.name}</div>
                      <div className="text-xs text-muted truncate">→ {m.buyer.name}</div>
                      <div className="text-xs mt-1"><span className="text-amber font-medium">{m.waste_name}</span> <span className="text-muted">replaces {m.material} · {num(m.tradable_tonnes)} {unitFor(m.category)}/mo · {Math.round(m.distance_km)} km</span></div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-emerald tabular-nums">{inr(m.net_saving_per_year)}</div>
                      <div className="text-[10px] text-muted mb-1">per year</div>
                      <ScorePill score={m.score} />
                    </div>
                  </Link>
                </li>
              ))}
              {!top.length && <li className="p-5 text-sm text-muted">No exchanges above this score. Lower the minimum feasibility.</li>}
            </ol>
          )}
          <Link to="/impact" className="px-5 py-3 border-t border-border text-sm text-brand font-medium flex items-center gap-1 hover:bg-bg">See impact across all clusters <ArrowRight size={14} /></Link>
        </aside>
      </div>
    </AppPage>
  );
}
