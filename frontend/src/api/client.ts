import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Cluster, DemoAccount, DiscoverResult, Exchange, ExchangeList, Gaps, GraphData, Inbox, InquiryRow, MatchAssessment, Passport, Pathway,
  SourcingCandidate, SourcingLeadRow, SourcingRequestRow, User, Backups, RouteRow, LandedCost,
  MaterialPhoto, VisualMatches, PhotoSearch, ProcessorRow, FactorRow, Extraction, Impact, Industry, IndustryDetail, InferItem, LoopsResponse, Match, MatchDetail, Meta, Params,
  SearchResult, SimulateResponse, NotificationList,
} from "../types";

// Production (Vercel): the API is on the same domain under /api. Local dev: the FastAPI server on :8000.
const API_ORIGIN = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8000" : "");
export const api = axios.create({ baseURL: `${API_ORIGIN}/api` });
const get = <T,>(url: string, params?: object) => api.get<T>(url, { params }).then((r) => r.data);

export const useClusters = () => useQuery({ queryKey: ["clusters"], queryFn: () => get<Cluster[]>("/clusters") });
export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => get<Meta>("/meta"), staleTime: Infinity });
export const useImpact = (cluster?: string) =>
  useQuery({ queryKey: ["impact", cluster], queryFn: () => get<Impact>("/impact", { cluster }) });
export const useIndustries = (cluster?: string) =>
  useQuery({ queryKey: ["industries", cluster], queryFn: () => get<Industry[]>("/industries", { cluster }) });
export const useIndustry = (id?: string) =>
  useQuery({ queryKey: ["industry", id], queryFn: () => get<IndustryDetail>(`/industries/${id}`), enabled: !!id });
export const useMatches = (p: { cluster?: string; industry_id?: number; min_score?: number; limit?: number }) =>
  useQuery({ queryKey: ["matches", p], queryFn: () => get<Match[]>("/matches", p) });
export const useMatch = (id?: string) =>
  useQuery({ queryKey: ["match", id], queryFn: () => get<MatchDetail>(`/matches/${id}`), enabled: !!id });
export const useGraph = (cluster?: string) =>
  useQuery({ queryKey: ["graph", cluster], queryFn: () => get<GraphData>("/graph", { cluster }) });
export const useLoops = (cluster?: string) =>
  useQuery({ queryKey: ["loops", cluster], queryFn: () => get<LoopsResponse>("/graph/loops", { cluster }) });
export const useSimulate = (cluster: string | undefined, params: Params) =>
  useQuery({
    queryKey: ["simulate", cluster, params],
    queryFn: () => api.post<SimulateResponse>("/simulate", { cluster, params }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
export const useReverseSearch = (p: { material: string; lat: number; lon: number; qty: number } | null) =>
  useQuery({
    queryKey: ["reverse", p],
    queryFn: () => get<{ material: string; matched_wastes: string[]; results: SearchResult[] }>("/search/reverse", p!),
    enabled: !!p,
  });

export const inferByproducts = (body: { type: string; capacity: number; text?: string }) =>
  api.post<{ llm: boolean; items: InferItem[] }>("/infer", body).then((r) => r.data);

export function useCreateIndustry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => api.post<Industry & { matches_created: number }>("/industries", body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ---------------------------------------------------------------- accounts & deal requests
export const useDemoAccounts = () => useQuery({ queryKey: ["demo-accounts"], queryFn: () => get<DemoAccount[]>("/auth/demo-accounts") });
export const login = (email: string, password: string) =>
  api.post<{ token: string; user: User }>("/auth/login", { email, password }).then((r) => r.data);
export const register = (body: object) =>
  api.post<{ token: string; user: User; matches_created: number }>("/auth/register", body).then((r) => r.data);

export const useInbox = (enabled: boolean) =>
  useQuery({ queryKey: ["inbox"], queryFn: () => get<Inbox>("/inquiries"), enabled, refetchInterval: enabled ? 15_000 : false });

export function useSendInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { match_id: number; monthly_tonnes?: number; price_per_tonne?: number; message?: string }) =>
      api.post<InquiryRow>("/inquiries", body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useRespondInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reply }: { id: number; status: "accepted" | "declined"; reply?: string }) =>
      api.patch<InquiryRow>(`/inquiries/${id}`, { status, reply }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function apiError(e: unknown): string {
  const ax = e as { response?: { data?: { detail?: unknown } }; message?: string };
  const d = ax?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x: { msg?: string }) => x.msg).join(", ");
  return ax?.message ?? "Something went wrong";
}

// ---------------------------------------------------------------- upgrade APIs
export const useMatchAssessment = (id?: string | number) =>
  useQuery({ queryKey: ["assessment", String(id)], queryFn: () => get<MatchAssessment>(`/matches/${id}/assessment`), enabled: !!id });
export const discoverAlternatives = (body: object) => api.post<DiscoverResult>("/alternatives/discover", body).then((r) => r.data);
export const usePassport = (id?: string) => useQuery({ queryKey: ["passport", id], queryFn: () => get<Passport>(`/materials/${id}`), enabled: !!id });
export const usePathways = (id?: string) =>
  useQuery({ queryKey: ["pathways", id], queryFn: () => get<{ material: string; unit: string; monthly_tonnes: number; pathways: Pathway[]; note: string }>(`/materials/${id}/pathways`), enabled: !!id });
export const useExchanges = (enabled: boolean) =>
  useQuery({ queryKey: ["exchanges"], queryFn: () => get<ExchangeList>("/exchanges"), enabled, refetchInterval: enabled ? 15_000 : false });
export const useExchange = (id?: string) => useQuery({ queryKey: ["exchange", id], queryFn: () => get<Exchange>(`/exchanges/${id}`), enabled: !!id });
export const useGaps = (cluster: string) => useQuery({ queryKey: ["gaps", cluster], queryFn: () => get<Gaps>("/network/gaps", { cluster }) });
export const useSourcingRequests = (enabled: boolean) => useQuery({ queryKey: ["sourcing"], queryFn: () => get<SourcingRequestRow[]>("/sourcing-requests"), enabled });
export const useSourcingCandidates = (id: number | null) =>
  useQuery({ queryKey: ["sourcing", id], queryFn: () => get<{ request: SourcingRequestRow; confirmed: SourcingCandidate[]; potential: SourcingCandidate[]; note: string }>(`/sourcing-requests/${id}`), enabled: !!id });
export const useSourcingLeads = (enabled: boolean) => useQuery({ queryKey: ["leads"], queryFn: () => get<SourcingLeadRow[]>("/sourcing-leads"), enabled });

export function useApiMutation<TBody>(fn: (b: TBody) => Promise<unknown>, invalidate: unknown[][] = []) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k })) });
}

// ---------------------------------------------------------------- buyer-side execution
export const useBackups = (id?: string | number) => useQuery({ queryKey: ["backups", String(id)], queryFn: () => get<Backups>(`/matches/${id}/backups`), enabled: !!id });
export const useRoutes = (id?: string | number) => useQuery({ queryKey: ["routes", String(id)], queryFn: () => get<{ routes: RouteRow[]; note: string }>(`/matches/${id}/routes`), enabled: !!id });
export const calcLandedCost = (id: number, body: object) => api.post<LandedCost>(`/matches/${id}/landed-cost`, body).then((r) => r.data);

// ---------------------------------------------------------------- photos, registries, extraction
export const useSupplyPhotos = (sid?: string | number) => useQuery({ queryKey: ["photos", "supply", String(sid)], queryFn: () => get<MaterialPhoto[]>(`/materials/${sid}/images`), enabled: !!sid });
export const useRequirementPhotos = (did?: number | null) => useQuery({ queryKey: ["photos", "req", did], queryFn: () => get<MaterialPhoto[]>(`/demands/${did}/images`), enabled: !!did });
export const useVisualMatches = (did?: number | null, enabled = true) =>
  useQuery({ queryKey: ["visual", did], queryFn: () => get<VisualMatches>(`/demands/${did}/visual-matches`), enabled: !!did && enabled, retry: false });
export const photoSearch = (file: File, demandId?: number | null) => {
  const fd = new FormData(); fd.append("file", file); if (demandId) fd.append("demand_id", String(demandId));
  return api.post<PhotoSearch>("/vision/search", fd).then((r) => r.data);
};
export const uploadPhoto = (path: string, file: File, caption?: string) => {
  const fd = new FormData(); fd.append("file", file); if (caption) fd.append("caption", caption);
  return api.post<MaterialPhoto>(path, fd).then((r) => r.data);
};
export const deletePhoto = (id: number) => api.delete(`/images/${id}`);
export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: ["notifications"], queryFn: () => get<NotificationList>("/notifications"), enabled, refetchInterval: enabled ? 15_000 : false, refetchIntervalInBackground: true });
export const markNotificationsRead = (ids?: number[]) => api.post("/notifications/read", ids ? { ids } : {});
export const setEmailAlerts = (email_alerts: boolean) => api.patch("/notifications/preferences", { email_alerts });
export const extractDocument = (file: File) => { const fd = new FormData(); fd.append("file", file); return api.post<Extraction>("/evidence/extract", fd).then((r) => r.data); };
export const useProcessors = () => useQuery({ queryKey: ["processors"], queryFn: () => get<{ processors: ProcessorRow[]; input_materials: string[]; properties: string[] }>("/processors") });
export const useFactors = () => useQuery({ queryKey: ["factors"], queryFn: () => get<{ factors: FactorRow[]; note: string }>("/factors") });
