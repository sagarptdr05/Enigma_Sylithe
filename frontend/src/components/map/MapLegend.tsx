import { metaFor } from "../../lib/industryMeta";

/** Overlay legend: line colour = feasibility, line width = tonnes, marker = industry type. */
export default function MapLegend({ types }: { types: string[] }) {
  const bands = [["#16A34A", "Strong ≥ 80"], ["#0284C7", "Good 65–79"], ["#D97706", "Fair 50–64"]];
  return (
    <div className="rounded-lg bg-white/95 border border-border shadow-soft px-3 py-2.5 text-[11px] text-ink max-w-[260px]">
      <div className="font-semibold text-[10px] uppercase tracking-wider text-muted mb-1">Exchange feasibility</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {bands.map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded" style={{ background: c }} />{l}</span>)}
      </div>
      <div className="text-muted mt-1">Thicker line = more tonnes per month</div>
      {types.length > 0 && <>
        <div className="font-semibold text-[10px] uppercase tracking-wider text-muted mt-2 mb-1">Plants</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {types.map((t) => { const m = metaFor(t); return <span key={t} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />{m.label}</span>; })}
        </div>
      </>}
    </div>
  );
}
