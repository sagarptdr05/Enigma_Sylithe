import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, LogIn, Zap } from "lucide-react";
import Page from "../components/layout/Page";
import Logo from "../components/layout/Logo";
import { apiError, login, useDemoAccounts } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { metaFor } from "../lib/industryMeta";

export default function Login() {
  const nav = useNavigate();
  const auth = useAuth();
  const demos = useDemoAccounts();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await login(email, password);
      auth.setSession(r.token, r.user);
      nav("/my");
    } catch (ex) { setErr(apiError(ex)); } finally { setBusy(false); }
  };
  const demo = async (id: number) => {
    setBusy(true); setErr("");
    try { await auth.demoLogin(id); nav("/my"); } catch (ex) { setErr(apiError(ex)); } finally { setBusy(false); }
  };

  return (
    <Page className="max-w-5xl">
      <div className="grid md:grid-cols-2 gap-6 items-start py-6">
        <form onSubmit={submit} className="card p-8">
          <Logo size={36} />
          <h1 className="text-3xl font-semibold text-brand mt-4">Log in to your plant</h1>
          <p className="text-muted mt-1">Manage your by-products, buyers and deal requests.</p>
          <label className="block mt-6"><div className="label mb-1">Work email</div>
            <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
          <label className="block mt-4"><div className="label mb-1">Password</div>
            <input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <p className="text-sm text-danger mt-3">{err}</p>}
          <button className="btn-primary w-full mt-6 py-3" disabled={busy}><LogIn size={16} /> {busy ? "Logging in…" : "Log in"}</button>
          <p className="text-sm text-muted mt-5 text-center">New to Sylithex? <Link to="/signup" className="text-emerald font-medium">Register your plant</Link></p>
        </form>

        {!!demos.data?.length && (
          <div className="card p-6">
            <div className="flex items-center gap-2 label text-emerald"><Zap size={13} /> Demo accounts</div>
            <h2 className="text-xl font-semibold mt-1">Try it as a real plant</h2>
            <p className="text-sm text-muted mt-1">One-click login for judging. Log in as the steel plant to send an offer, then as the cement plant to accept it.</p>
            <div className="mt-4 space-y-2">
              {demos.data.map((d) => {
                const m = metaFor(d.industry.type);
                return (
                  <button key={d.user_id} disabled={busy} onClick={() => demo(d.user_id)}
                    className="w-full text-left card card-hover p-3 flex items-center gap-3">
                    <div className="rounded-lg p-2" style={{ background: `${m.color}1a`, color: m.color }}><m.icon size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{d.industry.name}</div>
                      <div className="text-xs text-muted">{d.contact_name} · {d.designation} · {d.industry.cluster}</div>
                    </div>
                    <ArrowRight size={16} className="text-muted" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
