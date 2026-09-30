import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, PlayCircle, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, useDemoAccounts } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useDemo } from "../../context/DemoContext";
import type { DemoAccount, Exchange } from "../../types";

const BUYER = "Raigad Cement Works Ltd";
const SUPPLIER = "Deccan Phosphates & Fertilizers Ltd";
const CEMENT_BUYER = "Boisar Portland Cements Ltd";
type Ctx = { streamId?: number; matchId?: number; exchangeId?: number; completedId?: number };
interface Step { title: string; text: string; path: (c: Ctx) => string; as?: string; highlight?: string; enter?: (c: Ctx) => Promise<void> }

const act = (id: number, body: object) => api.post(`/exchanges/${id}/action`, body).catch(() => undefined);
const getX = (id: number) => api.get<Exchange>(`/exchanges/${id}`).then((r) => r.data);
const DISCOVER = "/discover?use=cement%20production&current=Virgin%20gypsum&qty=500&auto=1";

const STEPS: Step[] = [
  { title: "1 · A cement plant buys virgin gypsum", as: BUYER, path: () => "/my?tab=buy",
    text: "We are logged in as Raigad Cement Works (Taloja). It buys mineral gypsum every month and does not know which by-product could replace it.",
    enter: async (c) => {
      const sc = await api.get<{ match_id: number | null; material_id: number | null; completed_exchange_id: number | null }>("/showcase").then((r) => r.data);
      c.matchId = sc.match_id ?? undefined; c.streamId = sc.material_id ?? undefined; c.completedId = sc.completed_exchange_id ?? undefined;
    } },
  { title: "2 · Describe the need, not the waste", as: BUYER, path: () => DISCOVER, highlight: "discover-form",
    text: "Cement production, virgin gypsum, 500 t/month. Sylithex maps this to the cement gypsum specification and searches listed and AI-inferred supply." },
  { title: "3 · Alternatives, coverage and single-source risk", as: BUYER, path: () => DISCOVER, highlight: "supply-plan",
    text: "Phosphogypsum and chemical gypsum are found. The plan shows how the 500 t would be covered without exceeding any supplier's capacity, and flags that only one source is qualified." },
  { title: "4 · Eligibility is separate from the score", as: BUYER, path: (c) => `/match/${c.matchId}`, highlight: "eligibility",
    text: "Eligible, with conditions open: purity is UNKNOWN (never counted as a pass) and permits are missing. The blocker engine names the owner and the next action." },
  { title: "5 · True landed cost per usable tonne", as: BUYER, path: (c) => `/match/${c.matchId}?tab=cost`, highlight: "landed-cost",
    text: "Freight, loading, storage, processing, testing and rejected loads are added, then divided by usable tonnes after acceptance and processing losses. Compared with virgin gypsum on the same basis, with sensitivity and break-even distance." },
  { title: "6 · Supply assurance and backups", as: BUYER, path: (c) => `/match/${c.matchId}?tab=supply`, highlight: "backups",
    text: "Availability was confirmed recently, but delivery reliability is “not established”: there is no history yet. The backup finder ranks other qualified sources and allocates demand safely." },
  { title: "7 · Missing link: a processing route", as: BUYER, path: (c) => `/match/${c.matchId}?tab=routes`, highlight: "routes",
    text: "Through a gypsum purification unit, purity becomes PASS, at a known yield, capacity and landed cost. The route is labelled a hypothesis with its unresolved checks." },
  { title: "8 · Material passport, confidential supplier", as: BUYER, path: (c) => `/material/${c.streamId}`,
    text: "Each value shows its source, and evidence shows its dates and review state. The supplier chose confidential mode, so its name and exact site are hidden." },
  { title: "9 · Express interest", as: BUYER, path: (c) => (c.exchangeId ? `/exchange/${c.exchangeId}` : "/my?tab=exchanges"),
    enter: async (c) => {
      if (!c.matchId) return;
      const list = await api.get<{ outgoing: Exchange[] }>("/exchanges").then((r) => r.data);
      const open = list.outgoing.find((x) => x.match.id === c.matchId && ["pending", "accepted"].includes(x.status));
      c.exchangeId = open ? open.id : (await api.post<Exchange>("/exchanges", { match_id: c.matchId, monthly_tonnes: 500, message: "We'd like to trial your phosphogypsum as a gypsum substitute. Please share a purity report.", include_stages: ["evidence", "assessment", "sample"] }).then((r) => r.data)).id;
    },
    text: "An exchange opens at the INTEREST stage, with a qualification plan generated from the actual gaps: purity test, SDS, permits, drying, storage review, controlled trial and buyer approval." },
  { title: "10 · Mutual consent reveals identities", as: SUPPLIER, path: (c) => `/exchange/${c.exchangeId}`, highlight: "consent",
    enter: async (c) => { if (c.exchangeId && (await getX(c.exchangeId)).stage === "interest") await act(c.exchangeId, { action: "accept", reveal_identity: true, text: "Happy to share a purity report." }); },
    text: "Now logged in as the supplier: it accepts and consents. Both consents are in, so names, contacts and evidence files are shared." },
  { title: "11 · Evidence with dates and issuer", as: SUPPLIER, path: (c) => `/exchange/${c.exchangeId}`, highlight: "next-action",
    enter: async (c) => {
      if (!c.exchangeId || !c.streamId) return;
      if ((await getX(c.exchangeId)).stage === "evidence") {
        const fd = new FormData();
        fd.append("type", "lab_report"); fd.append("title", "Phosphogypsum purity & moisture"); fd.append("issuer", "NABL-accredited lab (illustrative)");
        fd.append("issue_date", new Date().toISOString().slice(0, 10)); fd.append("test_method", "IS 1288, gravimetric");
        fd.append("reported_values", JSON.stringify({ purity_pct: 91, CaO: 31.4, moisture: 16 }));
        await api.post(`/materials/${c.streamId}/evidence`, fd).catch(() => undefined);
        await act(c.exchangeId, { action: "submit_evidence" });
      }
    },
    text: "The supplier uploads a dated lab report (purity 91%) and submits the evidence package. Uploading does not make it verified: it stays “under review” until a facilitator accepts it." },
  { title: "12 · Qualification & trial plan", as: BUYER, path: (c) => `/exchange/${c.exchangeId}?tab=plan`, highlight: "checklist",
    enter: async (c) => {
      if (!c.exchangeId) return;
      let x = await getX(c.exchangeId);
      if (x.stage === "assessment") await act(c.exchangeId, { action: "record_assessment", result: "pass", text: "Purity 91%, CaO 31.4%: within spec after drying" });
      x = await getX(c.exchangeId);
      if (x.stage === "sample") await act(c.exchangeId, { action: "record_sample", result: "pass", text: "Setting time within limits" });
    },
    text: "Back as the buyer: assessment and sample pass. The plan tracks each task's owner, due date and acceptance criteria. Only the buyer's authorised reviewer can approve industrial use." },
  { title: "13 · Time Machine", path: () => "/simulator?cluster=Taloja%20MIDC&diesel_multiplier=1.4&processing_multiplier=1.25",
    text: "Diesel +40% and processing +25%: every match, landed cost and route is recalculated with the same engine. Scenarios never change the records and are not predictions." },
  { title: "14 · Batch records and deviations", as: CEMENT_BUYER, path: (c) => `/exchange/${c.completedId}?tab=deliveries`, highlight: "batches",
    text: "A completed slag exchange in Tarapur: batch B01 was partly rejected (moisture 11% vs 10% limit) with a corrective action, and batch B02 passed. Accepted and rejected tonnes are kept separately." },
  { title: "15 · Impact: estimate, reported, verified", as: CEMENT_BUYER, path: (c) => `/exchange/${c.completedId}?tab=impact`, highlight: "impact-record",
    text: "Net CO2 = virgin production avoided − transport − processing, with factors, sources and boundary. The reported result was independently checked by a facilitator." },
  { title: "16 · Impact you can trust", path: () => "/impact", highlight: "impact-tiers",
    text: "Potential, committed, reported and independently verified impact, never added together. Sylithex turns a promising match into a qualified, costed and tracked exchange." },
];

export default function DemoTour() {
  const { active, step, setStep, setActive } = useDemo();
  const nav = useNavigate();
  const auth = useAuth();
  const demos = useDemoAccounts();
  const qc = useQueryClient();
  const ctx = useRef<Ctx>({});
  const [busy, setBusy] = useState(false);
  const cur = STEPS[step];

  const accounts = useRef(demos.data);
  accounts.current = demos.data;
  useEffect(() => {
    if (!active || !cur) return;
    let cancel = false;
    (async () => {
      setBusy(true);
      try {
        const list = accounts.current ?? (await api.get<DemoAccount[]>("/auth/demo-accounts").then((r) => r.data));
        if (cur.as && auth.user?.industry?.name !== cur.as) {
          const acc = list?.find((d) => d.industry.name === cur.as);
          if (acc) await auth.demoLogin(acc.user_id);
        }
        await cur.enter?.(ctx.current);
        qc.invalidateQueries();  // refresh in the background; never block the tour on it
      } catch {
        /* a failed demo action should not freeze the tour */
      } finally {
        setBusy(false);
        if (!cancel) nav(cur.path(ctx.current));
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step]);

  useEffect(() => {
    if (!active || !cur?.highlight || busy) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-demo="${cur.highlight}"]`);
      el?.classList.add("demo-highlight");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 900);
    return () => { clearTimeout(t); document.querySelectorAll(".demo-highlight").forEach((e) => e.classList.remove("demo-highlight")); };
  }, [active, step, busy, cur?.highlight]);

  return (
    <AnimatePresence>
      {active && cur && (
        <div className="fixed inset-x-0 bottom-4 z-[2000] flex justify-center px-4 pointer-events-none">
          <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40, opacity: 0 }}
            className="pointer-events-auto relative w-full max-w-[600px] card p-5 shadow-pop">
            <button className="absolute top-3 right-3 text-muted hover:text-ink" onClick={() => setActive(false)} aria-label="Close demo"><X size={16} /></button>
            <div className="flex items-center gap-2 text-xs text-emerald font-medium"><PlayCircle size={14} /> Guided demo · {cur.as ? `acting as ${cur.as}` : "overview"}
              {busy && <Loader2 size={13} className="animate-spin text-muted" />}</div>
            <h3 className="font-semibold text-lg mt-1 pr-6">{cur.title}</h3>
            <p className="text-sm text-muted mt-1.5">{cur.text}</p>
            <div className="flex items-center gap-2 mt-4">
              <div className="flex gap-1 flex-1">{STEPS.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-emerald" : "bg-border"}`} />)}</div>
              <button className="btn-ghost !px-3 !py-1.5" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}><ChevronLeft size={14} /> Back</button>
              {step < STEPS.length - 1
                ? <button className="btn-primary !px-3 !py-1.5" disabled={busy} onClick={() => setStep(step + 1)}>Next <ChevronRight size={14} /></button>
                : <button className="btn-primary !px-3 !py-1.5" onClick={() => setActive(false)}>Finish</button>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
