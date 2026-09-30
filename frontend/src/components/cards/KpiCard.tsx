import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const c = animate(prev.current, value, { duration: 1.2, ease: "easeOut", onUpdate: setDisplay });
    prev.current = value;
    return () => c.stop();
  }, [value]);
  return <>{format(display)}</>;
}

export function KpiCard({ label, value, format, icon: Icon, sub }: {
  label: string; value: number; format: (n: number) => string; icon: LucideIcon; color?: string; sub?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between text-[12px] text-muted">{label}<Icon size={15} className="text-muted/70" /></div>
      <div className="text-[22px] font-semibold tabular-nums text-ink mt-0.5"><CountUp value={value} format={format} /></div>
      {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
    </div>
  );
}
