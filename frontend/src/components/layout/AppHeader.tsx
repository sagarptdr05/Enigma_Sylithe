import type { ReactNode } from "react";
import { CountUp } from "../cards/KpiCard";

/** Page header: where you are, what the page answers, primary actions. */
export default function AppHeader({ eyebrow, title, description, right, children }: {
  eyebrow: string; title: ReactNode; description: ReactNode; right?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="bg-surface border-b border-border">
      <div className="mx-auto max-w-[1440px] px-5 lg:px-8 pt-6 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="max-w-3xl min-w-0">
            <div className="text-xs font-medium text-muted">{eyebrow}</div>
            <h1 className="text-[24px] leading-tight font-semibold mt-1 text-ink">{title}</h1>
            {description && <p className="text-sm text-muted mt-1.5 leading-relaxed">{description}</p>}
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </section>
  );
}

export interface Stat { label: string; value: number; format: (n: number) => string; sub?: string }

export function StatStrip({ stats, demo }: { stats: Stat[]; demo?: string }) {
  return (
    <div data-demo={demo} className={`grid grid-cols-2 md:grid-cols-3 ${stats.length >= 6 ? "xl:grid-cols-6" : stats.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4"} rounded-lg border border-border bg-surface divide-x divide-border overflow-hidden`}>
      {stats.map((s) => (
        <div key={s.label} className="px-4 py-3 border-b border-border xl:border-b-0">
          <div className="text-[11.5px] text-muted">{s.label}</div>
          <div className="text-[20px] font-semibold mt-0.5 tabular-nums text-ink"><CountUp value={s.value} format={s.format} /></div>
          {s.sub && <div className="text-[11px] text-muted mt-0.5">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; dark?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-border bg-subtle p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 h-8 rounded text-[13px] whitespace-nowrap transition-colors ${o.value === value ? "bg-surface text-ink font-medium shadow-soft border border-border" : "text-muted hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; badge?: number | string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-border overflow-x-auto -mb-px">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={`px-3 py-2.5 text-[13.5px] border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 ${value === t.value ? "border-brand text-ink font-medium" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}{t.badge !== undefined && t.badge !== 0 && <span className="rounded bg-subtle border border-border px-1.5 text-[11px] text-muted">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function AppPage({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex-1">
      {header}
      <div className="mx-auto max-w-[1440px] px-5 lg:px-8 py-6">{children}</div>
    </div>
  );
}
