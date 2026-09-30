import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import AppHeader, { AppPage, Segmented, StatStrip } from "../components/layout/AppHeader";
import NetworkGraph, { STATUS_COLOR } from "../components/graph/NetworkGraph";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { useClusters, useGaps, useGraph, useLoops } from "../api/client";
import { inr, num } from "../lib/format";
import { metaFor } from "../lib/industryMeta";
import type { GraphData, Loop } from "../types";

const SHORT: Record<string, string> = { "Taloja MIDC": "Taloja", "Tarapur MIDC": "Tarapur", "Kolhapur Agro Belt": "Kolhapur", "Pune-Chakan Urban": "Pune-Chakan" };
const shortName = (n: string) => n.replace(/ (Pvt )?Ltd\.?$| LLP$/, "");

function LoopSteps({ l, mode }: { l: Loop; mode: "loops" | "chains" | "gaps" }) {
  return (
    <ol className="relative mt-3 space-y-0">
      {l.edges.map((e, i) => {
        const src = l.members.find((m) => m.id === e.source)!;
        const M = metaFor(src.type);
        return (
          <li key={i} className="relative pl-7 pb-3">
            <span className="absolute left-0 top-0.5 h-5 w-5 rounded-full flex items-center justify-center" style={{ background: `${M.color}22`, color: M.color }}><M.icon size={12} /></span>
            <span className="absolute left-[9px] top-6 bottom-0 w-px bg-border" />
            <div className="text-sm font-medium leading-tight">{shortName(e.source_name)}</div>
            <Link to={e.match_id ? `/match/${e.match_id}` : "#"} className="text-xs text-muted hover:text-brand block mt-0.5">
              sends <span className="text-amber font-medium">{e.material}</span> → replaces {e.buyer_material} · <span className="text-emerald">{inr(e.saving)}/yr</span>
            </Link>
          </li>
        );
      })}
      <li className="pl-7 text-xs text-emerald font-medium">
        {mode === "loops" ? `↺ back to ${shortName(l.members[0].name)}: loop closed` : shortName(l.members[l.members.length - 1].name)}
      </li>
    </ol>
  );
}

export default function NetworkPage() {
  const nav = useNavigate();
  const clusters = useClusters();
  const [cluster, setCluster] = useState("Tarapur MIDC");
  const [mode, setMode] = useState<"loops" | "chains" | "gaps">("loops");
  const [density, setDensity] = useState<"top" | "all">("top");
  const [idx, setIdx] = useState<number | null>(null);
  const graph = useGraph(cluster);
  const loops = useLoops(cluster);
  const gaps = useGaps(cluster);
  const list = (mode === "loops" ? loops.data?.loops : mode === "chains" ? loops.data?.chains : []) ?? [];
  const cur = idx !== null && mode !== "gaps" ? list[idx] : undefined;
  // declutter: each plant's 2 most valuable outgoing links + anything with an exchange status + highlighted edges
  const shown: GraphData | undefined = useMemo(() => {
    if (!graph.data) return undefined;
    if (density === "all") return graph.data;
    const keep = new Set<string>();
    const bySrc = new Map<number, typeof graph.data.links>();
    for (const l of graph.data.links) { const k = l.source as number; bySrc.set(k, [...(bySrc.get(k) ?? []), l]); }
    for (const ls of bySrc.values()) [...ls].sort((a, b) => b.saving - a.saving).slice(0, 2).forEach((l) => keep.add(`${l.source}-${l.target}`));
    graph.data.links.forEach((l) => { if (!["INFERRED", "POTENTIAL", undefined].includes(l.status)) keep.add(`${l.source}-${l.target}`); });
    (loops.data?.loops ?? []).concat(loops.data?.chains ?? []).forEach((lp) => lp.edges.forEach((e) => { if (cur && cur === lp) keep.add(`${e.source}-${e.target}`); }));
    return { nodes: graph.data.nodes, links: graph.data.links.filter((l) => keep.has(`${l.source}-${l.target}`)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.data, density, idx, mode]);
  const highlight = useMemo(() => cur ? {
    nodes: new Set(cur.members.map((m) => m.id)), edges: new Set(cur.edges.map((e) => `${e.source}-${e.target}`)),
  } : undefined, [cur]);

  const types = [...new Set((graph.data?.nodes ?? []).map((n) => n.type))];

  const header = (
    <AppHeader eyebrow="Symbiosis network" title={`Who can feed whom in ${SHORT[cluster] ?? cluster}`}
      description="Each dot is a plant. An arrow from A to B means A's by-product can replace a raw material B buys (feasibility ≥ 50). A closed loop is a group where every plant is both a supplier and a buyer: the blueprint for an eco-industrial park."
      right={clusters.data && <Segmented value={cluster} onChange={(c) => { setCluster(c); setIdx(null); }}
        options={clusters.data.map((c) => ({ value: c.name, label: SHORT[c.name] ?? c.name }))} />}>
      {graph.data && loops.data ? <StatStrip stats={[
        { label: "Plants", value: graph.data.nodes.length, format: (n) => num(n) },
        { label: "Supply links", value: graph.data.links.length, format: (n) => num(n) },
        { label: "Closed loops", value: loops.data.totals.loops, format: (n) => num(n) },
        { label: "Multi-hop chains", value: loops.data.totals.chains, format: (n) => num(n) },
        { label: "Value in loops / yr", value: loops.data.totals.loop_saving, format: (n) => inr(n) },
        { label: "CO2 in loops / yr", value: loops.data.totals.loop_co2, format: (n) => `${num(n)} t` },
      ]} /> : <Skeleton className="h-20" />}
    </AppHeader>
  );

  return (
    <AppPage header={header}>
      <div className="grid xl:grid-cols-[1fr_400px] gap-5">
        <section className="card overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
            <Segmented dark={false} value={mode} onChange={(m) => { setMode(m); setIdx(null); }}
              options={[{ value: "loops", label: "Closed loops" }, { value: "chains", label: "Multi-hop chains" }, { value: "gaps", label: "Opportunity gaps" }]} />
            {mode !== "gaps" && <button className="btn-primary" data-demo="reveal" disabled={!list.length}
              onClick={() => setIdx((i) => (i === null ? 0 : (i + 1) % list.length))}>
              <Sparkles size={15} /> {idx === null ? `Reveal hidden ${mode === "loops" ? "loops" : "chains"}` : `Next ${mode === "loops" ? "loop" : "chain"}`}
            </button>}
            {idx !== null && <button className="btn-ghost" onClick={() => setIdx(null)}><RotateCcw size={14} /> Show all</button>}
            <span className="ml-auto"><Segmented dark={false} value={density} onChange={setDensity} options={[{ value: "top", label: "Key links" }, { value: "all", label: "All links" }]} /></span>
          </div>
          <div className="h-[620px] relative">
            {graph.error ? <div className="p-4"><ErrorState error={graph.error} /></div> : shown ?
              <NetworkGraph data={shown} highlight={highlight} onNodeClick={(n) => nav(`/industry/${n.id}`)} /> : <Skeleton className="h-full !rounded-none" />}
            <div className="absolute bottom-3 left-3 max-w-[75%] rounded-lg bg-black/35 backdrop-blur px-3 py-2 text-[11px] text-white/85 space-y-1">
              <div className="flex flex-wrap gap-x-3 gap-y-1">{types.map((t) => { const m = metaFor(t); return <span key={t} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{m.label}</span>; })}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-white/70">{Object.entries(STATUS_COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded" style={{ background: c }} />{k.toLowerCase()}</span>)}</div>
            </div>
            <div className="absolute top-3 right-3 text-[11px] text-white/60">Hover a plant to trace its links · click to open it</div>
          </div>
        </section>

        {mode === "gaps" ? <aside className="card min-w-0 p-5 space-y-5 max-h-[683px] overflow-auto" data-demo="gaps">
          <div>
            <h2 className="font-semibold text-lg">Where opportunities stall</h2>
            <p className="text-xs text-muted">From every technically possible pairing to exchanges that could be signed today.</p>
          </div>
          {gaps.isLoading || !gaps.data ? <Skeleton className="h-60" /> : <>
            <div className="space-y-2">{gaps.data.funnel.map((f, i) => {
              const max = gaps.data!.funnel[0].count || 1;
              return <div key={f.stage}><div className="flex justify-between text-sm"><span>{f.stage}</span><b className="tabular-nums">{num(f.count)}</b></div>
                <div className="h-2 rounded bg-bg mt-1"><div className="h-full rounded" style={{ width: `${Math.max((f.count / max) * 100, 1.5)}%`, background: ["#0E2F36", "#0284C7", "#16A34A", "#D97706", "#15803D"][i] }} /></div></div>; })}</div>
            <div className="rounded-lg border border-amber/40 bg-amber/5 p-3 text-sm"><div className="text-[11px] uppercase tracking-wider font-semibold text-amber">Main bottleneck</div>
              <p className="font-medium mt-0.5">{gaps.data.bottleneck.explanation}</p><p className="text-xs text-muted">{num(gaps.data.bottleneck.lost)} opportunities lost at “{gaps.data.bottleneck.stage}”.</p></div>
            {[["Evidence gaps", gaps.data.evidence_gaps.map((g) => [g.item, `${g.matches} matches`])],
              ["Supply gaps: demand with no supplier", gaps.data.supply_gaps.map((g) => [g.material, `${g.plants} plants · ${num(g.monthly)}/mo`])],
              ["Demand gaps: by-products with no buyer", gaps.data.demand_gaps.map((g) => [g.material, `${g.plants} plants · ${num(g.monthly)}/mo`])],
              ["Processing gaps", gaps.data.processing_gaps.map((g) => [g.step, `${g.matches} pairs`])],
              ["Geography gaps", gaps.data.geography_gaps.map((g) => [g.material, `${g.matches} pairs too far`])]].map(([t, rows]) => (
              <div key={t as string}><div className="text-[11px] uppercase tracking-wider font-semibold text-muted mb-1">{t as string}</div>
                {(rows as string[][]).length ? <ul className="text-sm divide-y divide-border">{(rows as string[][]).slice(0, 5).map(([a, b]) => <li key={a} className="flex justify-between py-1"><span>{a}</span><span className="text-muted">{b}</span></li>)}</ul>
                  : <p className="text-xs text-muted">None</p>}</div>))}
          </>}
        </aside> : <aside className="card min-w-0 flex flex-col max-h-[683px]">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <h2 className="font-semibold text-lg">{mode === "loops" ? "Closed loops" : "Multi-hop chains"} <span className="text-muted font-normal text-sm">({list.length})</span></h2>
            <p className="text-xs text-muted">{mode === "loops" ? "Every member supplies the next and the last feeds the first." : "A plant in the middle turns one waste into another useful stream."} Ranked by yearly value.</p>
          </div>
          <div className="overflow-auto flex-1 divide-y divide-border">
            {loops.isLoading && <div className="p-4"><Skeleton className="h-64" /></div>}
            {list.map((l, i) => (
              <div key={i} className={`px-5 py-3 cursor-pointer transition-colors ${idx === i ? "bg-emerald-soft/60" : "hover:bg-bg"}`} onClick={() => setIdx(idx === i ? null : i)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center -space-x-1">
                    {l.members.map((m) => { const M = metaFor(m.type); return <span key={m.id} className="h-6 w-6 rounded-full border-2 border-white flex items-center justify-center" style={{ background: M.color }} title={m.name}><M.icon size={11} color="#fff" /></span>; })}
                    <span className="pl-3 text-xs text-muted">{l.members.length} plants</span>
                  </div>
                  <span className="text-sm font-semibold text-emerald tabular-nums">{inr(l.total_saving)}/yr</span>
                </div>
                <div className="text-xs text-muted mt-1.5 truncate">{l.members.map((m) => metaFor(m.type).label).join(" → ")}{mode === "loops" && " → ↺"}</div>
                {idx === i && <LoopSteps l={l} mode={mode} />}
              </div>
            ))}
            {!loops.isLoading && !list.length && <p className="p-5 text-sm text-muted">None found in this cluster.</p>}
          </div>
          {cur && <Link to="/simulator" className="px-5 py-3 border-t border-border text-sm text-brand font-medium flex items-center gap-1 hover:bg-bg">Stress-test these links in the simulator <ArrowRight size={14} /></Link>}
        </aside>}
      </div>
    </AppPage>
  );
}
