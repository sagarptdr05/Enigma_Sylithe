import L from "leaflet";
import { renderToStaticMarkup } from "react-dom/server";
import { metaFor } from "../../lib/industryMeta";

const cache = new Map<string, L.DivIcon>();

export function industryIcon(type: string, size = 28, highlight = false): L.DivIcon {
  const key = `${type}-${size}-${highlight}`;
  if (!cache.has(key)) {
    const { color, icon: Icon } = metaFor(type);
    const html = renderToStaticMarkup(
      <div className="marker-icon" style={{
        width: size, height: size, background: color,
        boxShadow: highlight ? `0 0 0 3px #16A34A, 0 4px 18px ${color}` : `0 3px 10px ${color}66`,
      }}>
        <Icon size={size * 0.55} color="#FFFFFF" strokeWidth={2.4} />
      </div>,
    );
    cache.set(key, L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
  }
  return cache.get(key)!;
}

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
