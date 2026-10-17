import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { startOfflineSync } from "../lib/offline/engine";
import { EmptyState, LoadingState, Toaster } from "../components/feedback";
import { CommandPalette } from "../features/palette/CommandPalette";
import { LoginPage } from "../features/auth/LoginPage";
import { HubPage } from "../features/hub/HubPage";
import { PublicRequestPage } from "../features/public/PublicRequestPage";
import { SiteRoute } from "../runtime/SiteRoutes";
import { useSession } from "../stores/session";

// Rarely used platform screens load on demand.
const NewSitePage = lazy(() => import("../features/provisioning/NewSitePage").then((m) => ({ default: m.NewSitePage })));
const TrustConsolePage = lazy(() => import("../features/security-console/TrustConsolePage").then((m) => ({ default: m.TrustConsolePage })));

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === "unknown") return <div className="p-8"><LoadingState label="Restoring session…" /></div>;
  // Remember where the user was so signing in again returns them there.
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><HubPage /></RequireAuth>} />
        <Route path="/public/:slug/request" element={<PublicRequestPage />} />
        <Route path="/hub" element={<RequireAuth><HubPage /></RequireAuth>} />
        <Route path="/hub/sites" element={<RequireAuth><HubPage view="sites" /></RequireAuth>} />
        <Route path="/hub/builder" element={<RequireAuth><HubPage view="builder" /></RequireAuth>} />
        <Route path="/sites/new" element={<RequireAuth><NewSitePage /></RequireAuth>} />
        <Route path="/admin/provision" element={<RequireAuth><NewSitePage /></RequireAuth>} />
        <Route path="/trust" element={<RequireAuth><TrustConsolePage /></RequireAuth>} />
        <Route path="/s/:slug/*" element={<RequireAuth><SiteRoute /></RequireAuth>} />
        <Route path="/preview/:slug/*" element={<RequireAuth><SiteRoute preview /></RequireAuth>} />
        <Route path="*" element={<div className="p-8"><EmptyState title="Page not found" hint="That address does not exist." /></div>} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  const restore = useSession((s) => s.restore);
  useEffect(() => {
    void restore();
  }, [restore]);
  useEffect(() => startOfflineSync(), []);
  return (
    <BrowserRouter>
      <AppRoutes />
      <CommandPalette />
      <Toaster />
    </BrowserRouter>
  );
}
