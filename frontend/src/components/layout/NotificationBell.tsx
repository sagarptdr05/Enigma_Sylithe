import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, CheckCheck, FileCheck2, Handshake, LifeBuoy, Mail, MonitorSmartphone, PackageSearch, X } from "lucide-react";
import { markNotificationsRead, setEmailAlerts, useNotifications } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { AppNotification } from "../../types";

const ICON = { exchange: Handshake, sourcing: PackageSearch, evidence: FileCheck2, facilitation: LifeBuoy, impact: FileCheck2 };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const desktopSupported = () => typeof window !== "undefined" && "Notification" in window;

/** Mounted once in the app shell: tab title count, desktop pop-ups for new alerts, fresh badges. */
export function NotificationWatcher() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotifications(!!user);
  const seen = useRef<number | null>(null);

  useEffect(() => { seen.current = null; }, [user?.id]);

  useEffect(() => {
    const unread = n.data?.unread ?? 0;
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [n.data?.unread]);

  useEffect(() => {
    const items = n.data?.items;
    if (!items) return;
    const top = items[0]?.id ?? 0;
    if (seen.current === null) { seen.current = top; return; } // first load: don't pop up old alerts
    const fresh = items.filter((i) => i.id > (seen.current ?? 0) && !i.read);
    seen.current = Math.max(seen.current, top);
    if (!fresh.length) return;
    qc.invalidateQueries({ queryKey: ["exchanges"] });
    qc.invalidateQueries({ queryKey: ["exchange"] });
    if (desktopSupported() && Notification.permission === "granted" && document.hidden) {
      for (const i of fresh.slice(0, 3)) {
        try {
          const pop = new Notification(i.title, { body: i.body ?? undefined, tag: `sylithex-${i.id}` });
          pop.onclick = () => { window.focus(); markNotificationsRead([i.id]).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })); if (i.link) nav(i.link); pop.close(); };
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
    }
  }, [n.data?.items, qc, nav]);
  return null;
}

function Row({ i, onOpen }: { i: AppNotification; onOpen: (i: AppNotification) => void }) {
  const Icon = ICON[i.kind] ?? Bell;
  return (
    <button onClick={() => onOpen(i)} className={`w-full text-left flex gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-subtle ${i.read ? "" : "bg-emerald/[0.05]"}`}>
      <span className={`mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${i.read ? "bg-subtle text-muted" : "bg-emerald/10 text-emerald"}`}><Icon size={14} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={`text-[13px] leading-snug flex-1 ${i.read ? "text-muted" : "font-medium"}`}>{i.title}</span>
          {!i.read && <span className="mt-1.5 h-2 w-2 rounded-full bg-emerald shrink-0" aria-label="Unread" />}
        </span>
        {i.body && <span className="block text-xs text-muted mt-0.5 line-clamp-2">{i.body}</span>}
        <span className="block text-[11px] text-muted/80 mt-1">{ago(i.created_at)}{i.emailed && i.emailed !== "off" ? " · emailed" : ""}</span>
      </span>
    </button>
  );
}

export default function NotificationBell({ onNavigate, dark = true }: { onNavigate?: () => void; dark?: boolean }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotifications(!!user);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(desktopSupported() ? Notification.permission : "unsupported");
  const panel = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!user) return null;
  const d = n.data;
  const unread = d?.unread ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const openItem = (i: AppNotification) => {
    if (!i.read) markNotificationsRead([i.id]).then(refresh);
    setOpen(false);
    if (i.link) { nav(i.link); onNavigate?.(); }
  };
  const askDesktop = async () => { try { setPerm(await Notification.requestPermission()); } catch { setPerm("denied"); } };

  return (
    <>
      <button ref={btn} onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}
        className={`relative p-2 rounded-md ${dark ? "text-white/70 hover:text-white hover:bg-white/10" : "text-muted hover:text-brand hover:bg-subtle"}`}>
        {unread ? <BellRing size={18} /> : <Bell size={18} />}
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber text-white text-[10.5px] font-semibold flex items-center justify-center">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Notifications"
          className="fixed z-[1300] left-2 right-2 top-16 lg:left-[248px] lg:right-auto lg:top-3 lg:w-[400px] max-h-[calc(100vh-5rem)] flex flex-col rounded-lg border border-border bg-surface shadow-xl text-ink">
          <div className="flex items-center gap-2 px-4 h-12 border-b border-border shrink-0">
            <span className="font-semibold text-sm flex-1">Notifications{unread ? <span className="text-muted font-normal"> · {unread} unread</span> : null}</span>
            {unread > 0 && <button className="btn-link text-xs flex items-center gap-1" onClick={() => markNotificationsRead().then(refresh)}><CheckCheck size={13} /> Mark all as read</button>}
            <button className="p-1 text-muted hover:text-ink" onClick={() => setOpen(false)} aria-label="Close notifications"><X size={15} /></button>
          </div>
          <div className="overflow-y-auto flex-1">
            {!d ? <p className="p-4 text-sm text-muted">Loading…</p>
              : d.items.length ? d.items.map((i) => <Row key={i.id} i={i} onOpen={openItem} />)
              : <p className="p-6 text-sm text-muted text-center">No notifications yet. You'll be told here when a buyer, supplier or the facilitator acts on something of yours.</p>}
          </div>
          <div className="border-t border-border px-4 py-3 space-y-2.5 text-xs shrink-0 bg-subtle/60 rounded-b-lg">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5" style={{ accentColor: "#15803D" }} checked={!!d?.email_alerts} disabled={!d}
                onChange={(e) => setEmailAlerts(e.target.checked).then(refresh)} />
              <span><span className="font-medium flex items-center gap-1"><Mail size={13} /> Email me these alerts</span>
                <span className="text-muted block">{d?.email_mode === "outbox" ? "Sent to your work email. In this demo, emails are saved to the server outbox instead of being sent." : "Sent to your work email."}</span></span>
            </label>
            {perm !== "unsupported" && (
              <div className="flex items-start gap-2.5">
                <MonitorSmartphone size={14} className="mt-0.5 text-muted shrink-0" />
                <span className="flex-1">
                  <span className="font-medium">Desktop alerts</span>
                  <span className="text-muted block">
                    {perm === "granted" ? "On. You'll get a pop-up when Sylithex is open in a background tab."
                      : perm === "denied" ? "Blocked. Allow notifications for this site in your browser settings."
                      : "Get a pop-up when something happens while Sylithex is in another tab."}
                  </span>
                </span>
                {perm === "default" && <button className="btn-primary !h-7 !px-2.5 !text-xs" onClick={askDesktop}>Turn on</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
