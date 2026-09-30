import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

export default function FactorRadar({ f }: { f: { technical: number; economic: number; co2: number; distance: number; timing: number } }) {
  const data = [
    { k: "Technical", v: f.technical }, { k: "Economic", v: f.economic }, { k: "CO2", v: f.co2 },
    { k: "Distance", v: f.distance }, { k: "Timing", v: f.timing },
  ].map((d) => ({ ...d, v: Math.round(d.v * 100) }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#E1E5E2" />
          <PolarAngleAxis dataKey="k" tick={{ fill: "#5E6E72", fontSize: 12 }} />
          <Radar dataKey="v" stroke="#16A34A" fill="#16A34A" fillOpacity={0.3} />
          <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E1E5E2", borderRadius: 12 }} formatter={(v) => [`${v}%`, "score"]} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
