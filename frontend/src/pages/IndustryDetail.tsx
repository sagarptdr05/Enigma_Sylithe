import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, FileCheck2, IndianRupee, MapPin, ShieldAlert, Sparkles } from "lucide-react";
import Page from "../components/layout/Page";
import MatchCard from "../components/cards/MatchCard";
import { ErrorState, SkeletonList } from "../components/cards/Feedback";
import { useIndustry } from "../api/client";
import { CATEGORY_COLOR, inr, num, pct, unitFor } from "../lib/format";
import { TrustBadge } from "../components/cards/Badges";
import { metaFor } from "../lib/industryMeta";
import type { WasteStream } from "../types";

function StreamCard({ s, hidden }: { s: WasteStream; hidden: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`card p-4 ${hidden ? "border-amber/40" : ""}`} data-demo={hidden ? "hidden-stream" : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[s.category] }} />
        <h3 className="font-semibold">{s.waste_name}</h3>
        <span className="text-sm text-muted">{num(s.monthly_tonnes)} {unitFor(s.category)}/month · {s.category}</span>
        <TrustBadge trust={s.trust} />
        {s.trust === "ai_inferred" && <span className="text-xs text-muted">{s.source === "llm_inferred" ? "LLM" : "knowledge base"} · {pct(s.confidence)} confidence</span>}
        {s.hazardous && <span className="chip bg-danger/15 text-danger"><ShieldAlert size={11} /> Hazardous</span>}
        <Link to={`/material/${s.id}`} className="ml-auto text-xs text-brand font-medium">Passport →</Link>
      </div>
      {hidden && s.reasoning && <p className="text-xs text-muted mt-2 flex gap-1.5"><BrainCircuit size={13} className="shrink-0 mt-0.5 text-amber" />{s.reasoning}</p>}
      <div className="mt-3 grid gap-2">
        {s.top_matches.length ? s.top_matches.map((m) => <MatchCard key={m.id} m={m} />) :
          <p className="text-xs text-muted">No viable buyer within range yet.</p>}
      </div>
    </motion.div>
  );
}

export default function IndustryDetail() {
  const { id } = useParams();
  const q = useIndustry(id);
  if (q.isLoading) return <Page><SkeletonList n={5} h="h-32" /></Page>;
  if (q.error || !q.data) return <Page><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const d = q.data;
  const m = metaFor(d.type);
  const declared = d.waste_streams.filter((s) => s.source === "declared");
  const hidden = d.waste_streams.filter((s) => s.source !== "declared");
  const replaceable = d.demands.filter((x) => x.top_suppliers.length);
  return (
    <Page>
      <div className="card p-6 mb-6 flex flex-wrap gap-6 items-center">
        <div className="rounded-lg p-4" style={{ background: `${m.color}22`, color: m.color }}><m.icon size={32} /></div>
        <div className="flex-1 min-w-[240px]">
          <div className="text-sm" style={{ color: m.color }}>{m.label}</div>
          <h1 className="text-2xl md:text-3xl font-semibold">{d.name}</h1>
          <div className="text-sm text-muted mt-1 flex flex-wrap gap-x-4">
            <span className="flex items-center gap-1"><MapPin size={13} />{d.address ?? d.cluster}</span>
            <span>{num(d.capacity)} {d.capacity_unit}</span>
          </div>
          {d.process_description && <p className="text-sm text-muted mt-3 max-w-3xl">{d.process_description}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="card px-4 py-3"><div className="label">Can earn/save</div><div className="font-display text-xl text-emerald">{inr(d.totals.outgoing_saving)}</div></div>
          <div className="card px-4 py-3"><div className="label">Hidden streams</div><div className="font-display text-xl text-amber">{d.totals.hidden_streams}</div></div>
        </div>
      </div>

      {d.track_record && (
        <div className="card p-4 mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="section-title">Track record on Sylithex</div>
          <span><span className="text-muted">Exchanges</span> <b>{d.track_record.exchanges}</b> ({d.track_record.completed} completed)</span>
          <span><span className="text-muted">Delivered</span> <b className="tabular-nums">{num(d.track_record.delivered_tonnes)} t</b></span>
          <span><span className="text-muted">Rejection rate</span> <b>{d.track_record.rejection_rate_pct != null ? `${d.track_record.rejection_rate_pct}%` : "-"}</b></span>
          <span><span className="text-muted">Evidence accepted</span> <b>{d.track_record.evidence_accepted}/{d.track_record.evidence_documents}</b></span>
        </div>
      )}
      <div className="grid xl:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><FileCheck2 size={18} className="text-muted" /> Declared waste</h2>
          <div className="space-y-4">
            {declared.length ? declared.map((s) => <StreamCard key={s.id} s={s} hidden={false} />) :
              <div className="card p-6 text-sm text-muted">This industry has <b className="text-ink">not declared any waste</b>. Sylithex inferred everything on the right from its type and capacity.</div>}
          </div>
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><Sparkles size={18} className="text-amber" /> Potential resources inferred by AI</h2>
          <p className="text-xs text-muted mb-3">Estimated from industry type, capacity and process text. Not confirmed inventory until the company declares it.</p>
          <div className="space-y-4">
            {hidden.length ? hidden.map((s) => <StreamCard key={s.id} s={s} hidden />) : <div className="card p-6 text-sm text-muted">No additional by-products found.</div>}
          </div>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><IndianRupee size={18} className="text-emerald" /> Raw materials you buy that nearby waste can replace</h2>
        {replaceable.length ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {replaceable.map((dm) => (
              <div key={dm.id} className="card p-4">
                <div className="flex justify-between items-baseline">
                  <h3 className="font-semibold">{dm.material}</h3>
                  <span className="text-xs text-muted">{num(dm.monthly_tonnes)}/mo · {inr(dm.virgin_price)}/unit</span>
                </div>
                <div className="text-xs text-muted mb-3">{dm.supplier_count} potential suppliers</div>
                <div className="space-y-2">{dm.top_suppliers.map((mm) => <MatchCard key={mm.id} m={mm} perspective="buyer" />)}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted">No substitutable inputs found nearby.</p>}
      </section>
      <div className="mt-8"><Link to={`/dashboard?cluster=${encodeURIComponent(d.cluster)}`} className="btn-ghost">Back to {d.cluster} <ArrowRight size={14} /></Link></div>
    </Page>
  );
}
