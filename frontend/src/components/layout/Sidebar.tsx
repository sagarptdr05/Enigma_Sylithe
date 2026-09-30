import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, BookOpenCheck, Building2, Camera, Factory, FileSearch, FlaskConical, History, Inbox, LayoutDashboard, LogIn, LogOut, Menu, PlayCircle, Share2, ShieldCheck, UserPlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAuth } from "../../context/AuthContext";
import { useDemo } from "../../context/DemoContext";
import { useExchanges } from "../../api/client";
import Logo from "./Logo";
import NotificationBell, { NotificationWatcher } from "./NotificationBell";

function Item({ to, icon: Icon, label, badge, match }: { to: string; icon: typeof Factory; label: string; badge?: number; match?: (p: string, s: string) => boolean }) {
  const loc = useLocation();
  const active = match ? match(loc.pathname, loc.search) : loc.pathname === to.split("?")[0];
  return (
    <NavLink to={to} className={`flex items-center gap-2.5 rounded-md px-2.5 h-9 text-[13.5px] transition-colors ${active ? "bg-white/10 text-white font-medium" : "text-white/65 hover:text-white hover:bg-white/5"}`}>
      <Icon size={16} className={active ? "text-emerald-300" : ""} style={active ? { color: "#6EE7A0" } : undefined} />
      <span className="flex-1">{label}</span>
      {!!badge && <span className="min-w-5 h-5 px-1 rounded bg-amber text-white text-[11px] font-semibold flex items-center justify-center">{badge}</span>}
    </NavLink>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mt-5"><div className="px-2.5 mb-1.5 text-[10.5px] uppercase tracking-wider text-white/40 font-medium">{title}</div><div className="space-y-0.5">{children}</div></div>;
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const demo = useDemo();
  const nav = useNavigate();
  const ex = useExchanges(!!user?.industry);
  const waiting = ex.data?.pending_incoming ?? 0;
  const tabIs = (t: string) => (p: string, s: string) => p === "/my" && new URLSearchParams(s).get("tab") === t;
  return (
    <div className="flex flex-col h-full" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      <div className="flex items-center h-14">
        <Link to="/" className="flex items-center gap-2 px-2.5 font-brand font-bold text-[19px] text-white flex-1"><Logo size={26} /> Sylithex</Link>
        <span className="hidden lg:block"><NotificationBell /></span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin -mx-1 px-1">
        <Group title="Overview">
          <Item to="/dashboard" icon={LayoutDashboard} label="Clusters" />
          <Item to="/network" icon={Share2} label="Symbiosis network" />
          <Item to="/impact" icon={BarChart3} label="Impact" />
        </Group>
        <Group title="Source & evaluate">
          <Item to="/discover" icon={FileSearch} label="Discover alternatives" />
          <Item to="/photos" icon={Camera} label="Photo match" />
          <Item to="/processors" icon={FlaskConical} label="Processing facilities" />
          <Item to="/simulator" icon={History} label="Time Machine" />
        </Group>
        {user?.industry && <Group title="My workspace">
          <Item to="/my" icon={Factory} label="My plant" match={(p, s) => p === "/my" && !new URLSearchParams(s).get("tab")?.match(/exchanges|sourcing/)} />
          <Item to="/my?tab=exchanges" icon={Inbox} label="Exchanges" badge={waiting} match={(p, s) => tabIs("exchanges")(p, s) || p.startsWith("/exchange/")} />
          <Item to="/my?tab=sourcing" icon={Building2} label="Sourcing requests" match={tabIs("sourcing")} />
        </Group>}
        {user?.role === "facilitator" && <Group title="Facilitator"><Item to="/my" icon={ShieldCheck} label="Review queue" /></Group>}
        <Group title="Help">
          <Item to="/solutions" icon={BookOpenCheck} label="How Sylithex works" />
          <button onClick={() => { demo.setStep(0); demo.setActive(!demo.active); onNavigate?.(); }} aria-label="Demo mode"
            className={`w-full flex items-center gap-2.5 rounded-md px-2.5 h-9 text-[13.5px] ${demo.active ? "bg-emerald text-white" : "text-white/65 hover:text-white hover:bg-white/5"}`}>
            <PlayCircle size={16} /> {demo.active ? "Demo running" : "Guided demo"}
          </button>
        </Group>
      </div>
      <div className="border-t border-white/10 pt-3 mt-3">
        {user ? (
          <div className="flex items-center gap-2 px-1">
            <div className="h-8 w-8 rounded-full bg-white/10 text-white text-xs font-semibold flex items-center justify-center shrink-0">{user.contact_name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
            <div className="min-w-0 flex-1"><div className="text-[13px] text-white font-medium truncate">{user.contact_name}</div>
              <div className="text-[11px] text-white/50 truncate">{user.industry?.name ?? "MIDC Symbiosis Cell"}</div></div>
            <button className="text-white/55 hover:text-white p-1.5" title="Log out" aria-label="Log out" onClick={() => { logout(); nav("/"); }}><LogOut size={16} /></button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Link to="/login" className="btn h-8 text-[13px] bg-white/10 text-white hover:bg-white/15"><LogIn size={14} /> Log in</Link>
            <Link to="/signup" className="btn h-8 text-[13px] bg-white text-brand hover:bg-white/90"><UserPlus size={14} /> Register</Link>
          </div>
        )}
        <p className="text-[10.5px] text-white/35 mt-3 px-1 leading-snug">Illustrative data: fictional companies at real Maharashtra industrial areas.</p>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-full lg:pl-[240px]">
      <NotificationWatcher />
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[240px] bg-brand px-3 pb-3 flex-col z-[1100]"><Nav /></aside>
      <header className="lg:hidden sticky top-0 z-[1100] h-14 bg-brand flex items-center px-4 gap-3">
        <button className="text-white" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
        <Link to="/" className="flex items-center gap-2 font-brand font-bold text-white flex-1"><Logo size={22} /> Sylithex</Link>
        <NotificationBell />
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[1200] flex">
          <div className="w-[260px] bg-brand px-3 pb-3 flex flex-col"><button className="self-end text-white/70 mt-3 mr-1" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button><Nav onNavigate={() => setOpen(false)} /></div>
          <div className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
