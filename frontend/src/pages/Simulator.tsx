import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { IndianRupee, Leaf, Link2, Recycle, TrendingDown } from "lucide-react";
import AppHeader, { AppPage, Segmented } from "../components/layout/AppHeader";
import ClusterMap, { type MapLink } from "../components/map/ClusterMap";
import { KpiCard } from "../components/cards/KpiCard";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { useClusters, useSimulate } from "../api/client";
import { inr, num } from "../lib/format";
import type { Params } from "../types";

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

const DEFAULT: Params = { diesel_multiplier: 1, carbon_price: 0, max_distance: 300, virgin_price_multiplier: 1,
  processing_multiplier: 1, supply_multiplier: 1, demand_multiplier: 1, min_technical_fit: 0.4 };
const LABELS: Record<keyof Params, [string, (v: number) => string]> = {
  diesel_multiplier: ["Diesel price", (v) => `${Math.round(v * 100)}%`], carbon_price: ["Carbon price", (v) => `₹${v.toLocaleString("en-IN")}/tCO2`],
  max_distance: ["Max transport distance", (v) => `${v} km`], virgin_price_multiplier: ["Conventional material prices", (v) => `${Math.round(v * 100)}%`],
  processing_multiplier: ["Processing cost", (v) => `${Math.round(v * 100)}%`], supply_multiplier: ["Supplier output", (v) => `${Math.round(v * 100)}%`],
  demand_multiplier: ["Buyer demand", (v) => `${Math.round(v * 100)}%`], min_technical_fit: ["Minimum quality fit", (v) => `${Math.round(v * 100)}%`],
};

export default function Simulator() {
  const clusters = useClusters();
  const [cluster, setCluster] = useState("Tarapur MIDC");
  const [search] = useSearchParams();
  // scenarios can be deep-linked, e.g. /simulator?diesel_multiplier=1.4&processing_multiplier=1.25
  const [p, setP] = useState<Params>(() => {
    const out = { ...DEFAULT };
    (Object.keys(DEFAULT) as (keyof Params)[]).forEach((k) => { const v = search.get(k); if (v !== null && !isNaN(+v)) out[k] = +v; });
    return out;
  });
  useEffect(() => { const c = search.get("cluster"); if (c) setCluster(c); }, [search]);
  const params = useDebounced(p);
  const sim = useSimulate(cluster, params);
  const d = sim.data;
  const links: MapLink[] = useMemo(() => {
    const best = new Map<string, MapLink>();
    for (const m of d?.matches ?? []) {
      const k = `${m.source.id}-${m.buyer.id}`;
      if (!best.has(k) && m.buyer.cluster === cluster) best.set(k, { key: k, from: m.source, to: m.buyer, score: m.score, tonnes: m.tradable_tonnes, label: `${m.waste_name} → ${m.material}` });
    }
    return [...best.values()];
  }, [d, cluster]);
  const nodes = useMemo(() => {
    const map = new Map<number, MapLink["from"]>();
    links.forEach((l) => { map.set(l.from.id, l.from); map.set(l.to.id, l.to); });
    return [...map.values()];
  }, [links]);

  const Slider = ({ k, label, min, max, step, fmt }: { k: keyof Params; label: string; min: number; max: number; step: number; fmt: (v: number) => string }) => (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="text-muted">{label}</span><span className="font-medium">{fmt(p[k])}</span></div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={p[k]} onChange={(e) => setP({ ...p, [k]: +e.target.value })} />
    </div>
  );
  const delta = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}% vs baseline` : "");
  const changed = (Object.keys(DEFAULT) as (keyof Params)[]).filter((k) => p[k] !== DEFAULT[k]);

  return (
    <AppPage header={
      <AppHeader eyebrow="Source & evaluate / Time Machine" title="What if conditions change?"
        description="Change transport, carbon and material prices, processing cost, supply, demand or the quality threshold. Every match is recalculated with the same engine the platform uses. Scenarios never change the underlying records and are not predictions."
        right={clusters.data && <Segmented value={cluster} onChange={setCluster}
          options={clusters.data.map((c) => ({ value: c.name, label: c.name.replace(/ MIDC| Agro Belt| Urban/, "") }))} />} />}>
      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <aside className="card p-5 space-y-6 h-fit" data-demo="sliders">
          <Slider k="diesel_multiplier" label="Diesel price" min={0.5} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Slider k="carbon_price" label="Carbon price" min={0} max={5000} step={100} fmt={(v) => `₹${v.toLocaleString("en-IN")}/tCO2`} />
          <Slider k="max_distance" label="Max transport distance" min={50} max={500} step={10} fmt={(v) => `${v} km`} />
          <Slider k="virgin_price_multiplier" label="Conventional material prices" min={0.5} max={1.5} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
          <div className="border-t border-border pt-5 space-y-6">
            <Slider k="processing_multiplier" label="Processing cost" min={0.5} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Slider k="supply_multiplier" label="Supplier output" min={0.3} max={1.5} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Slider k="demand_multiplier" label="Buyer demand" min={0.3} max={1.5} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
            <Slider k="min_technical_fit" label="Minimum quality fit" min={0.4} max={0.95} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} />
          </div>
          <button className="btn-ghost w-full" onClick={() => setP(DEFAULT)}>Reset to baseline</button>
          <div className="text-xs text-muted">{sim.isFetching ? "Recomputing…" : "Up to date"}</div>
        </aside>
        <div className="space-y-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Scenario:</span>
            {changed.length ? changed.map((k) => <span key={k} className="chip bg-amber-soft text-amber border border-amber/30 !text-xs">{LABELS[k][0]} {LABELS[k][1](DEFAULT[k])} → {LABELS[k][1](p[k])}</span>)
              : <span className="chip bg-subtle text-muted !text-xs">Baseline (no assumptions changed)</span>}
          </div>
          {sim.error ? <ErrorState error={sim.error} /> : !d ? <Skeleton className="h-24" /> : (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              <KpiCard label="Savings / yr" value={d.kpis.saving_per_year} format={(n) => inr(n)} icon={IndianRupee} sub={delta(d.kpis.saving_per_year, d.baseline.saving_per_year)} />
              <KpiCard label="CO2 avoided / yr" value={d.kpis.co2_per_year} format={(n) => `${num(n)} t`} icon={Leaf} color="#0284C7" sub={delta(d.kpis.co2_per_year, d.baseline.co2_per_year)} />
              <KpiCard label="Waste diverted / yr" value={d.kpis.waste_diverted_per_year} format={(n) => `${num(n)} t`} icon={Recycle} color="#D97706" />
              <KpiCard label="Viable matches" value={d.viable_count} format={(n) => `${Math.round(n)} / ${d.baseline_count}`} icon={Link2} color="#7C3AED" sub={`${d.kpis.loops} closed loops`} />
            </div>
          )}
          <div className="grid xl:grid-cols-[1fr_380px] gap-4">
            <ClusterMap nodes={nodes} links={links} className="h-[480px]" />
            <div className="card p-4 h-[480px] flex flex-col">
              <h3 className="font-semibold flex items-center gap-2"><TrendingDown size={16} className="text-danger" /> Dropped out ({d?.dropped_count ?? 0})</h3>
              <div className="mt-3 space-y-2 overflow-auto flex-1">
                {d?.dropped.length ? d.dropped.map((m) => (
                  <div key={m.id} className="text-xs border border-border rounded-lg p-2">
                    <div className="font-medium text-ink truncate">{m.source.name} → {m.buyer.name}</div>
                    <div className="text-muted"><span className="text-amber">{m.waste_name}</span> → {m.material} · was {inr(m.net_saving_per_year)}/yr</div>
                    <div className="text-danger mt-0.5">{m.reason}</div>
                  </div>
                )) : <p className="text-sm text-muted">All baseline matches survive these conditions.</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
