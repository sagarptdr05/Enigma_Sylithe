import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { GNode, GraphData, GraphLink } from "../../types";
import { metaFor } from "../../lib/industryMeta";

const idOf = (v: number | GNode) => (typeof v === "object" ? v.id : v);
// force-graph renders tooltips as HTML: escape every user-controlled string (company names are user input)
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const BG = "#0F3139";
export const STATUS_COLOR: Record<string, string> = {
  INFERRED: "rgba(255,255,255,0.22)", POTENTIAL: "rgba(255,255,255,0.42)", ASSESSED: "#38BDF8", AGREED: "#FBBF24", ACTIVE: "#F97316", COMPLETED: "#4ADE80",
};

export default function NetworkGraph({ data, highlight, onNodeClick }: {
  data: GraphData; highlight?: { nodes: Set<number>; edges: Set<string> }; onNodeClick?: (n: GNode) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GraphLink>>();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<number | null>(null);
  const graph = useMemo(() => ({ nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) }), [data]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    fg.current?.d3Force("charge")?.strength(-260);
    const t = setTimeout(() => fg.current?.zoomToFit(0, 60), 1200);
    return () => clearTimeout(t);
  }, [graph]);

  const on = !!highlight && highlight.nodes.size > 0;
  const edgeKey = (l: GraphLink) => `${idOf(l.source)}-${idOf(l.target)}`;
  const isHi = (l: GraphLink) => on && highlight!.edges.has(edgeKey(l));
  const touchesHover = (l: GraphLink) => hover !== null && (idOf(l.source) === hover || idOf(l.target) === hover);

  return (
    <div ref={wrap} className="h-full w-full">
      <ForceGraph2D<GNode, GraphLink>
        ref={fg} graphData={graph} width={size.w} height={size.h} backgroundColor={BG}
        nodeRelSize={5} cooldownTicks={150}
        linkColor={(l) => (isHi(l) ? "#4ADE80" : on ? "rgba(255,255,255,0.05)" : touchesHover(l) ? "rgba(255,255,255,0.8)" : STATUS_COLOR[l.status ?? "INFERRED"])}
        linkLineDash={(l) => (l.status === "INFERRED" && !isHi(l) ? [2, 3] : null)}
        linkWidth={(l) => (isHi(l) ? 3 : touchesHover(l) ? 1.6 : ["AGREED", "ACTIVE", "COMPLETED"].includes(l.status ?? "") ? 2.4 : 0.9)}
        linkDirectionalArrowLength={(l) => (isHi(l) ? 6 : 3.5)} linkDirectionalArrowRelPos={0.92}
        linkDirectionalArrowColor={(l) => (isHi(l) ? "#4ADE80" : "rgba(255,255,255,0.35)")}
        linkDirectionalParticles={(l) => (isHi(l) ? 4 : 0)} linkDirectionalParticleWidth={3.5}
        linkDirectionalParticleColor={() => "#FBBF24"}
        linkLabel={(l) => `<div style="font:12px 'Space Grotesk';padding:2px 4px">${esc(l.material)} → ${esc(l.buyer_material)}<br/>score ${Math.round(l.score)} · ${esc(l.status ?? "INFERRED")}</div>`}
        onNodeClick={(n) => onNodeClick?.(n)} onNodeHover={(n) => setHover(n ? n.id : null)}
        nodeLabel={(n) => `<div style="font:12px 'Space Grotesk';padding:2px 4px"><b>${esc(n.name)}</b><br/>${esc(metaFor(n.type).label)}</div>`}
        nodeCanvasObject={(n, ctx, scale) => {
          const m = metaFor(n.type);
          const dim = on && !highlight!.nodes.has(n.id);
          const r = on && !dim ? 7 : 5;
          ctx.globalAlpha = dim ? 0.18 : 1;
          ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI); ctx.fillStyle = m.color; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = on && !dim ? "#4ADE80" : BG; ctx.stroke();
          if ((on && !dim) || hover === n.id || scale > 2.4) {
            const fs = Math.max(3.5, 11 / scale);
            ctx.font = `500 ${fs}px 'Space Grotesk', sans-serif`;
            const label = n.name.replace(/ (Pvt )?Ltd\.?$| LLP$/, "");
            const w = ctx.measureText(label).width;
            ctx.fillStyle = "rgba(15,49,57,0.85)";
            ctx.fillRect(n.x! - w / 2 - 2, n.y! + r + 2, w + 4, fs + 3);
            ctx.fillStyle = "#E6EEF0"; ctx.textAlign = "center"; ctx.textBaseline = "top";
            ctx.fillText(label, n.x!, n.y! + r + 3.5);
          }
          ctx.globalAlpha = 1;
        }}
      />
    </div>
  );
}
