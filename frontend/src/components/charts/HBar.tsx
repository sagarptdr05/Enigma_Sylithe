/** Single-series horizontal bars in plain HTML: one hue, direct value labels, hover title, no label wrapping. */
export default function HBar({ data, valueKey, labelKey, color, format }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[]; valueKey: string; labelKey: string; color: string; format: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  return (
    <div className="space-y-3">
      {data.map((d) => {
        const v = Number(d[valueKey]) || 0;
        return (
          <div key={d[labelKey]} className="grid grid-cols-[150px_1fr] items-center gap-3 group" title={`${d[labelKey]}: ${format(v)}`}>
            <span className="text-sm truncate">{d[labelKey]}</span>
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-[18px] rounded-r transition-opacity group-hover:opacity-80" style={{ width: `${Math.max((v / max) * 78, 1)}%`, background: color }} />
              <span className="text-xs font-semibold tabular-nums whitespace-nowrap">{format(v)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
