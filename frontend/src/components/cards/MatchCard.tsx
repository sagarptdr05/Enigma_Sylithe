import { Link } from "react-router-dom";
import { ArrowRight, ShieldAlert, Truck } from "lucide-react";
import type { Match } from "../../types";
import { inr, num, scoreColor, unitFor } from "../../lib/format";
import { metaFor } from "../../lib/industryMeta";

export default function MatchCard({ m, perspective = "source" }: { m: Match; perspective?: "source" | "buyer" | "both" }) {
  const other = perspective === "buyer" ? m.source : m.buyer;
  const Icon = metaFor(other.type).icon;
  return (
    <Link to={`/match/${m.id}`} className="card card-hover p-3 flex items-center gap-3 group">
      <div className="shrink-0 w-12 h-12 rounded-lg flex flex-col items-center justify-center font-display font-semibold"
        style={{ background: `${scoreColor(m.score)}1a`, color: scoreColor(m.score) }}>
        <span className="text-lg leading-none">{Math.round(m.score)}</span>
        <span className="text-[9px] uppercase opacity-80">score</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          {perspective === "both" ? (
            <>{m.source.name} <ArrowRight size={12} className="text-muted shrink-0" /> {m.buyer.name}</>
          ) : (
            <><Icon size={14} style={{ color: metaFor(other.type).color }} className="shrink-0" />{other.name}</>
          )}
        </div>
        <div className="text-xs text-muted truncate">
          <span className="text-amber">{m.waste_name}</span> → {m.material}
        </div>
        <div className="text-xs text-muted flex items-center gap-3 mt-0.5">
          <span className="text-emerald font-medium">{inr(m.net_saving_per_year)}/yr</span>
          <span>{num(m.tradable_tonnes)} {unitFor(m.category)}/mo</span>
          <span className="flex items-center gap-1"><Truck size={11} />{Math.round(m.distance_km)} km</span>
          {m.hazardous && <ShieldAlert size={12} className="text-danger" />}
        </div>
      </div>
      <ArrowRight size={16} className="text-muted group-hover:text-emerald transition-colors shrink-0" />
    </Link>
  );
}
