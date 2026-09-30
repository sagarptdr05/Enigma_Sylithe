import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { industryIcon, TILE_ATTR, TILE_URL } from "./markers";
import { scoreColor } from "../../lib/format";
import { metaFor } from "../../lib/industryMeta";

export interface MapNode { id: number; name: string; type: string; lat: number; lon: number }
export interface MapLink { key: string | number; from: MapNode; to: MapNode; score: number; tonnes: number; label?: string; dim?: boolean; animate?: boolean }

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const sig = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    const fit = () => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0], 12, { animate: false });
      else map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 15, animate: false });
    };
    fit();
    const timers = [setTimeout(fit, 400), setTimeout(fit, 1200)]; // re-fit after layout / transitions settle
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  return null;
}

export default function ClusterMap({ nodes, links, onSelect, selectedId, highlightIds, className = "h-[520px]" }: {
  nodes: MapNode[]; links: MapLink[]; onSelect?: (n: MapNode) => void; selectedId?: number;
  highlightIds?: Set<number>; className?: string;
}) {
  const maxT = Math.max(1, ...links.map((l) => l.tonnes));
  const pts = nodes.map((n) => [n.lat, n.lon] as [number, number]);
  return (
    <div className={`${className} w-full rounded-lg overflow-hidden border border-border`}>
      <MapContainer center={[19.0, 73.5]} zoom={8} className="h-full w-full" scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <FitBounds points={pts} />
        {links.map((l) => (
          <Polyline key={l.key} positions={[[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]]}
            pathOptions={{
              color: scoreColor(l.score), weight: 1.2 + 4 * Math.sqrt(l.tonnes / maxT),
              opacity: l.dim ? 0.12 : l.animate === false ? 0.55 : 0.85, className: l.animate === false ? "" : "flow-line",
            }}>
            {l.label && <Tooltip sticky>{l.label}</Tooltip>}
          </Polyline>
        ))}
        {nodes.map((n) => (
          <Marker key={n.id} position={[n.lat, n.lon]}
            icon={industryIcon(n.type, selectedId === n.id ? 36 : 28, selectedId === n.id || !!highlightIds?.has(n.id))}
            eventHandlers={{ click: () => onSelect?.(n) }}>
            <Tooltip direction="top" offset={[0, -12]}>
              <div className="text-xs"><b>{n.name}</b><br />{metaFor(n.type).label}</div>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
