import { Link } from "react-router-dom";
import { ArrowRight, Info, ShieldAlert } from "lucide-react";
import AppHeader, { AppPage, StatStrip } from "../components/layout/AppHeader";
import HBar from "../components/charts/HBar";
import FactorRegistry from "../components/assess/FactorRegistry";
import ScorePill from "../components/cards/ScorePill";
import { ErrorState, Skeleton } from "../components/cards/Feedback";
import { useImpact } from "../api/client";
import { CATEGORY_COLOR, inr, num, titleCase } from "../lib/format";

export default function ImpactPage() {
  const q = useImpact();
  const d = q.data;
  const totalCat = d?.by_category.reduce((a, c) => a + c.tonnes_per_year, 0) ?? 1;

  const header = (
    <AppHeader eyebrow="Overview / Impact" title="Impact, from model estimate to verified result"
      description="Yearly value if the exchanges Sylithex found were put in place. Totals use the optimiser's allocation, so a tonne of waste is never counted for two buyers.">
      {d ? <StatStrip demo="impact" stats={[
        { label: "Savings / year", value: d.saving_per_year, format: (n) => inr(n) },
        { label: "CO2 avoided / year", value: d.co2_per_year, format: (n) => `${num(n)} t` },
        { label: "Waste diverted / year", value: d.waste_diverted_per_year, format: (n) => `${num(n)} t` },
        { label: "Viable exchanges", value: d.matches, format: (n) => num(n) },
        { label: "Closed loops", value: d.loops, format: (n) => num(n) },
        { label: "Plants analysed", value: d.industries, format: (n) => num(n) },
      ]} /> : <Skeleton className="h-20" />}
    </AppHeader>
  );

  if (q.error) return <AppPage header={header}><ErrorState error={q.error} onRetry={() => q.refetch()} /></AppPage>;
  if (!d) return <AppPage header={header}><Skeleton className="h-96" /></AppPage>;

  const T = d.tiers;
  const tiers: [string, string, typeof T.potential, string][] = [
    ["Potential", "Model estimate", T.potential, "#94A3B8"], ["Committed", "Signed, not yet delivered", T.committed, "#0E2F36"],
    ["Reported", "Accepted tonnes recorded by buyers", T.reported, "#0369A1"], ["Independently verified", "Checked by a facilitator", T.verified, "#15803D"]];
  return (
    <AppPage header={header}>
      <section className="card p-5 mb-5" data-demo="impact-tiers">
        <h2 className="font-semibold">Impact, by level of certainty</h2>
        <p className="text-xs text-muted mb-4">These are never added together. Potential is what the model finds; committed is what companies have signed; reported is what buyers accepted after delivery; verified is the part a facilitator has checked against delivery records. Net CO2 subtracts transport and processing emissions.</p>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {tiers.map(([name, sub, t, c]) => (
            <div key={name} className="rounded-lg border border-border p-4" style={{ borderTop: `3px solid ${c}` }}>
              <div className="flex items-baseline justify-between"><span className="font-semibold">{name}</span><span className="text-xs text-muted">{sub}</span></div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                <div><div className="text-[10px] uppercase text-muted">Waste</div><div className="font-semibold tabular-nums">{num(t.tonnes)} t</div></div>
                <div><div className="text-[10px] uppercase text-muted">Value</div><div className="font-semibold tabular-nums">{inr(t.saving)}</div></div>
                <div><div className="text-[10px] uppercase text-muted">CO2</div><div className="font-semibold tabular-nums">{num(t.co2)} t</div></div>
              </div>
              <div className="text-[11px] text-muted mt-2">{t.exchanges} {name === "Potential" ? "viable matches" : "exchanges"} · {t.basis}</div>
            </div>))}
        </div>
      </section>
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card p-5">
          <h2 className="font-semibold">Savings by cluster</h2>
          <p className="text-xs text-muted mb-3">₹ per year, optimised allocation</p>
          <HBar data={d.by_cluster} labelKey="cluster" valueKey="saving_per_year" color="#16A34A" format={(v) => inr(v)} />
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">CO2 avoided by cluster</h2>
          <p className="text-xs text-muted mb-3">tonnes CO2 per year (virgin production avoided, minus transport)</p>
          <HBar data={d.by_cluster} labelKey="cluster" valueKey="co2_per_year" color="#0E2F36" format={(v) => `${num(v)} t`} />
        </section>
      </div>

      <div className="grid xl:grid-cols-[1fr_1.6fr] gap-5 mt-5">
        <section className="card p-5">
          <h2 className="font-semibold">Waste diverted by type</h2>
          <p className="text-xs text-muted mb-4">per year · energy streams in MWh</p>
          <div className="space-y-3.5">
            {d.by_category.map((c) => {
              const share = c.tonnes_per_year / totalCat;
              return (
                <div key={c.category}>
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[c.category] }} />{titleCase(c.category)}</span>
                    <span className="tabular-nums"><b>{num(c.tonnes_per_year)}</b> <span className="text-muted">{c.category === "energy" ? "MWh" : "t"} · {Math.round(share * 100)}%</span></span>
                  </div>
                  <div className="h-2 mt-1.5 rounded bg-bg overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.max(share * 100, 1)}%`, background: CATEGORY_COLOR[c.category] }} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 pt-5 pb-3"><h2 className="font-semibold">Ten most valuable exchanges</h2><p className="text-xs text-muted">Click a row for the full feasibility breakdown</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-bg text-left text-[11px] uppercase tracking-wider text-muted">
                <tr><th className="px-5 py-2.5 font-medium">#</th><th className="font-medium">Exchange</th><th className="font-medium">Material</th><th className="font-medium">Fit</th><th className="font-medium text-right">₹ / year</th><th className="font-medium text-right pr-5">CO2 / year</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.top.map((m, i) => (
                  <tr key={m.id} className="hover:bg-bg/60">
                    <td className="px-5 py-3 text-muted tabular-nums">{i + 1}</td>
                    <td className="py-3 pr-3"><Link to={`/match/${m.id}`} className="font-medium hover:text-brand">{m.source.name}</Link><div className="text-xs text-muted">→ {m.buyer.name} · {Math.round(m.distance_km)} km</div></td>
                    <td className="pr-3"><span className="text-amber font-medium">{m.waste_name}</span>{m.hazardous && <ShieldAlert size={12} className="inline ml-1 text-danger" />}<div className="text-xs text-muted">replaces {m.material}</div></td>
                    <td><ScorePill score={m.score} /></td>
                    <td className="text-right font-semibold text-emerald tabular-nums">{inr(m.net_saving_per_year)}</td>
                    <td className="text-right pr-5 tabular-nums">{num(m.co2_saved_per_year)} t</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card p-5 mt-5">
        <div className="section-title">Emission factors used</div>
        <p className="section-sub mb-3">Every factor behind the CO2 figures, with its source and review status.</p>
        <FactorRegistry />
      </section>

      <section className="card p-5 mt-5 flex gap-4">
        <Info className="text-brand shrink-0 mt-0.5" size={20} />
        <div className="text-sm text-muted space-y-1">
          <p className="text-ink font-medium">How these numbers are calculated</p>
          <p><b className="text-ink">Saving per tonne</b> = virgin material price − road transport (₹4.5/t-km) − processing + disposal cost avoided. For by-products already sold today (molasses, bagasse, scrap), their current sale value is subtracted.</p>
          <p><b className="text-ink">CO2</b> = emissions of producing the virgin material − transport emissions. <b className="text-ink">Totals</b> come from a linear program that allocates each supply to buyers without double counting.</p>
          <Link to="/simulator" className="text-brand font-medium inline-flex items-center gap-1 pt-1">Change prices and distances in the simulator <ArrowRight size={13} /></Link>
        </div>
      </section>
    </AppPage>
  );
}
