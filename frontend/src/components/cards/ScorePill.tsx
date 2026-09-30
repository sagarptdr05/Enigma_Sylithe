import { scoreColor } from "../../lib/format";

export const scoreLabel = (s: number) => (s >= 80 ? "Strong" : s >= 65 ? "Good" : s >= 50 ? "Fair" : "Weak");

export default function ScorePill({ score, showLabel = false }: { score: number; showLabel?: boolean }) {
  const c = scoreColor(score);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={{ background: `${c}14`, color: c, border: `1px solid ${c}33` }} title="Feasibility score (0-100)">
      {Math.round(score)}{showLabel && <span className="font-medium opacity-80">{scoreLabel(score)}</span>}
    </span>
  );
}
