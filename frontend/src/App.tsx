import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Navbar from "./components/layout/Navbar";
import AppShell from "./components/layout/Sidebar";
import DemoTour from "./components/layout/DemoTour";
import { SkeletonList } from "./components/cards/Feedback";

const Landing = lazy(() => import("./pages/Landing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const IndustryNew = lazy(() => import("./pages/IndustryNew"));
const IndustryDetail = lazy(() => import("./pages/IndustryDetail"));
const MatchDetail = lazy(() => import("./pages/MatchDetail"));
const NetworkPage = lazy(() => import("./pages/Network"));
const Find = lazy(() => import("./pages/Find"));
const Simulator = lazy(() => import("./pages/Simulator"));
const ImpactPage = lazy(() => import("./pages/Impact"));
const Login = lazy(() => import("./pages/Login"));
const MyPlant = lazy(() => import("./pages/MyPlant"));
const MaterialPassport = lazy(() => import("./pages/MaterialPassport"));
const ExchangeWorkspace = lazy(() => import("./pages/ExchangeWorkspace"));
const Solutions = lazy(() => import("./pages/Solutions"));
const PhotoMatch = lazy(() => import("./pages/PhotoMatch"));
const Processors = lazy(() => import("./pages/Processors"));

const MARKETING = ["/", "/login", "/signup"];

export default function App() {
  const location = useLocation();
  const marketing = MARKETING.includes(location.pathname);
  const routes = (
    <Suspense fallback={<div className="mx-auto max-w-[1440px] w-full px-5 lg:px-8 py-6"><SkeletonList /></div>}>
      <Routes location={location}>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/signup" element={<IndustryNew />} />
        <Route path="/industry/new" element={<Navigate to="/signup" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/my" element={<MyPlant />} />
        <Route path="/industry/:id" element={<IndustryDetail />} />
        <Route path="/match/:id" element={<MatchDetail />} />
        <Route path="/network" element={<NetworkPage />} />
        <Route path="/discover" element={<Find />} />
        <Route path="/find" element={<Navigate to="/discover" replace />} />
        <Route path="/material/:id" element={<MaterialPassport />} />
        <Route path="/exchange/:id" element={<ExchangeWorkspace />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/impact" element={<ImpactPage />} />
        <Route path="/solutions" element={<Solutions />} />
        <Route path="/photos" element={<PhotoMatch />} />
        <Route path="/processors" element={<Processors />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Suspense>
  );
  return (
    <div className="min-h-full flex flex-col">
      {marketing ? (
        <>
          <Navbar />
          <div className="flex-1">{routes}</div>
          <footer className="border-t border-border bg-surface py-6 text-center text-xs text-muted px-4">
            Sylithex · ENIGMA 5.0 · Illustrative data: fictional company names placed at real Maharashtra industrial areas,
            calibrated on typical Indian industry ratios and market prices.
          </footer>
        </>
      ) : <AppShell>{routes}</AppShell>}
      <DemoTour />
    </div>
  );
}
