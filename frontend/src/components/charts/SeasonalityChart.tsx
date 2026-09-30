import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num } from "../../lib/format";

export default function SeasonalityChart({ months, supply, demand, unit = "t" }: { months: string[]; supply: number[]; demand: number[]; unit?: string }) {
  const data = months.map((m, i) => ({ m, supply: supply[i], demand: demand[i] }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#D97706" stopOpacity={0.5} /><stop offset="1" stopColor="#D97706" stopOpacity={0} /></linearGradient>
            <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0284C7" stopOpacity={0.4} /><stop offset="1" stopColor="#0284C7" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="#E1E5E2" vertical={false} />
          <XAxis dataKey="m" tick={{ fill: "#5E6E72", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#5E6E72", fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => num(v)} width={50} />
          <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E1E5E2", borderRadius: 12 }} formatter={(v) => `${num(Number(v))} ${unit}`} />
          <Legend wrapperStyle={{ color: "#5E6E72", fontSize: 12 }} />
          <Area type="monotone" dataKey="supply" name="Supply" stroke="#D97706" fill="url(#gs)" strokeWidth={2} />
          <Area type="monotone" dataKey="demand" name="Demand" stroke="#0284C7" fill="url(#gd)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
