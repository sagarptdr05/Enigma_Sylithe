import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { User } from "../types";

const KEY = "sylithex_token";
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } },
};

let token: string | null = store.get();
api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

interface AuthState {
  user: User | null; loading: boolean;
  setSession: (token: string, user: User) => void; logout: () => void; demoLogin: (userId: number) => Promise<User>;
}
const Ctx = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!token);

  useEffect(() => {
    if (!token) return;
    api.get<User>("/auth/me").then((r) => setUser(r.data)).catch(() => { token = null; store.set(null); }).finally(() => setLoading(false));
  }, []);

  const setSession = (t: string, u: User) => { token = t; store.set(t); setUser(u); qc.invalidateQueries({ queryKey: ["inbox"] }); };
  const logout = () => {
    if (token) api.post("/auth/logout", null, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    token = null; store.set(null); setUser(null); qc.removeQueries({ queryKey: ["inbox"] });
  };
  const demoLogin = async (userId: number) => {
    const r = await api.post<{ token: string; user: User }>("/auth/demo-login", { user_id: userId });
    setSession(r.data.token, r.data.user);
    return r.data.user;
  };
  return <Ctx.Provider value={{ user, loading, setSession, logout, demoLogin }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
