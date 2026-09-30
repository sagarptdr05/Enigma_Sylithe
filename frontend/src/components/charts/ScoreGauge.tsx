import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { scoreColor } from "../../lib/format";

export default function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div className="relative h-44 w-44">
      <ResponsiveContainer>
        <RadialBarChart innerRadius="78%" outerRadius="100%" data={[{ v: score }]} startAngle={220} endAngle={-40}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="v" cornerRadius={10} fill={color} background={{ fill: "#E1E5E2" }} isAnimationActive />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-bold" style={{ color }}>{Math.round(score)}</span>
        <span className="label">feasibility</span>
      </div>
    </div>
  );
}
