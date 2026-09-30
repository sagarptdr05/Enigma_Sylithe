import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BrainCircuit, Check, Sparkles } from "lucide-react";
import Page, { PageHeader } from "../components/layout/Page";
import PinPicker from "../components/map/PinPicker";
import { apiError, register, useClusters, useMeta } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { metaFor } from "../lib/industryMeta";

const STEPS = ["Account", "Plant", "Process", "Analysis"];
const MESSAGES = ["Reading your process description…", "Estimating by-products from capacity…", "Normalising material names with embeddings…",
  "Matching compositions to buyer specs…", "Scoring economics, CO2, distance and timing…"];

/** Company registration: account + plant details -> AI inference -> My Plant dashboard. */
export default function IndustryNew() {
  const nav = useNavigate();
  const auth = useAuth();
  const meta = useMeta();
  const clusters = useClusters();
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState(0);
  const [err, setErr] = useState("");
  const [acct, setAcct] = useState({ contact_name: "", designation: "", phone: "", email: "", password: "" });
  const [form, setForm] = useState({ name: "", type: "steel", cluster: "Tarapur MIDC", address: "", lat: 19.815, lon: 72.72, capacity: 30000, process_description: "" });
  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const unit = meta.data?.industry_types.find((t) => t.type === form.type)?.capacity_unit ?? "";
  const center = clusters.data?.find((c) => c.name === form.cluster)?.center;
  const acctOk = acct.contact_name.length >= 2 && /\S+@\S+\.\S+/.test(acct.email) && acct.password.length >= 8;

  useEffect(() => {
    if (step !== 3) return;
    const t = setInterval(() => setMsg((m) => (m + 1) % MESSAGES.length), 900);
    const started = Date.now();
    setErr("");
    register({
      ...acct, designation: acct.designation || null, phone: acct.phone || null,
      industry: { ...form, capacity_unit: unit, address: form.address || null, process_description: form.process_description || null },
    }).then((r) => {
      setTimeout(() => { auth.setSession(r.token, r.user); nav("/my"); }, Math.max(0, 3200 - (Date.now() - started)));
    }).catch((e) => setErr(apiError(e)));
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (auth.user && step !== 3) return <Navigate to="/my" replace />;

  const pickCluster = (name: string) => {
    const c = clusters.data?.find((x) => x.name === name);
    setForm((f) => ({ ...f, cluster: name, ...(c ? { lat: +c.center.lat.toFixed(5), lon: +c.center.lon.toFixed(5) } : {}) }));
  };

  return (
    <Page className="max-w-3xl">
      <PageHeader title="Register your plant" subtitle="Tell us what you make. We'll tell you what you're throwing away and who wants it." />
      <div className="flex items-center gap-2 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold ${i < step ? "bg-emerald text-white" : i === step ? "bg-brand text-white" : "bg-border text-muted"}`}>
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${i === step ? "text-ink font-medium" : "text-muted"}`}>{s}</span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ x: 20 }} animate={{ x: 0 }} className="card p-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label><div className="label mb-1">Your name</div><input className="input" value={acct.contact_name} onChange={(e) => setAcct({ ...acct, contact_name: e.target.value })} placeholder="e.g. Priya Deshmukh" /></label>
                <label><div className="label mb-1">Designation</div><input className="input" value={acct.designation} onChange={(e) => setAcct({ ...acct, designation: e.target.value })} placeholder="e.g. EHS Manager" /></label>
                <label><div className="label mb-1">Work email</div><input className="input" type="email" autoComplete="email" value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} placeholder="you@company.com" /></label>
                <label><div className="label mb-1">Phone (shared only after a deal is accepted)</div><input className="input" value={acct.phone} onChange={(e) => setAcct({ ...acct, phone: e.target.value })} placeholder="+91" /></label>
              </div>
              <label className="block"><div className="label mb-1">Password (min 8 characters)</div><input className="input" type="password" autoComplete="new-password" value={acct.password} onChange={(e) => setAcct({ ...acct, password: e.target.value })} /></label>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Already registered? <Link to="/login" className="text-emerald font-medium">Log in</Link></span>
                <button className="btn-primary" disabled={!acctOk} onClick={() => setStep(1)}>Next <ArrowRight size={14} /></button>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <label className="block"><div className="label mb-1">Company / plant name</div><input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Sahyadri Steel Pvt Ltd" /></label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label><div className="label mb-1">Industry type</div>
                  <select className="input" value={form.type} onChange={(e) => set("type", e.target.value)}>
                    {meta.data?.industry_types.map((t) => <option key={t.type} value={t.type}>{metaFor(t.type).label}</option>)}
                  </select></label>
                <label><div className="label mb-1">Capacity ({unit})</div><input className="input" type="number" min={1} value={form.capacity} onChange={(e) => set("capacity", +e.target.value)} /></label>
                <label><div className="label mb-1">Industrial cluster</div>
                  <select className="input" value={form.cluster} onChange={(e) => pickCluster(e.target.value)}>
                    {clusters.data?.map((c) => <option key={c.name}>{c.name}</option>)}
                  </select></label>
                <label><div className="label mb-1">Address / plot no.</div><input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="e.g. Plot E-42, Tarapur MIDC" /></label>
              </div>
              <div>
                <div className="label mb-1">Location: click the map to drop a pin ({form.lat}, {form.lon})</div>
                {center && <PinPicker lat={form.lat} lon={form.lon} type={form.type} center={[center.lat, center.lon]} onPick={(lat, lon) => setForm((f) => ({ ...f, lat, lon }))} />}
              </div>
              <div className="flex justify-between">
                <button className="btn-ghost" onClick={() => setStep(0)}><ArrowLeft size={14} /> Back</button>
                <button className="btn-primary" disabled={!form.name || form.capacity <= 0} onClick={() => setStep(2)}>Next <ArrowRight size={14} /></button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-sm text-muted"><Sparkles className="text-amber shrink-0" size={18} />
                <span>Optional: describe your process in plain words. Our AI reads it to discover by-products you may never have declared.
                {meta.data && !meta.data.llm && <span className="text-xs block mt-1">(No API key configured: an offline rule engine is used.)</span>}</span></div>
              <textarea className="input min-h-40" value={form.process_description} onChange={(e) => set("process_description", e.target.value)}
                placeholder="e.g. We run a blast furnace and hot rolling mill. Slabs are reheated and pickled in hydrochloric acid before cold rolling…" />
              <div className="flex justify-between">
                <button className="btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={14} /> Back</button>
                <button className="btn-primary" onClick={() => setStep(3)}><BrainCircuit size={14} /> Create account & analyse</button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="py-10 flex flex-col items-center text-center">
              {err ? (
                <><p className="text-danger">{err}</p><button className="btn-ghost mt-4" onClick={() => setStep(err.includes("email") ? 0 : 2)}>Go back</button></>
              ) : (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                    className="rounded-full p-5 bg-emerald-soft text-emerald shadow-soft"><BrainCircuit size={40} /></motion.div>
                  <h3 className="text-xl font-semibold mt-6">AI is analysing your process</h3>
                  <AnimatePresence mode="wait">
                    <motion.p key={msg} initial={{ y: 6 }} animate={{ y: 0 }} className="text-muted mt-2">{MESSAGES[msg]}</motion.p>
                  </AnimatePresence>
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Page>
  );
}
