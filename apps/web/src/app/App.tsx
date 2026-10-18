import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LoadingState, SkeletonLoader, Toaster } from "../components/feedback";
import { LoginPage } from "../features/auth/LoginPage";
import { SiteRoute } from "../runtime/SiteRoutes";
import { WebsiteRoute } from "../runtime/WebsiteRenderer";
import { useSession } from "../stores/session";
import { EmptyState } from "../components/feedback";

const HubPage = lazy(() => import("../features/hub/HubPage").then((m) => ({ default: m.HubPage })));
const TrustConsolePage = lazy(() => import("../features/security-console/TrustConsolePage").then((m) => ({ default: m.TrustConsolePage })));
const NewSitePage = lazy(() => import("../features/provisioning/NewSitePage").then((m) => ({ default: m.NewSitePage })));

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === "unknown") return <div className="p-8"><LoadingState label="Restoring session…" /></div>;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="p-8"><SkeletonLoader rows={8} /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><HubPage /></RequireAuth>} />
        <Route path="/sites/new" element={<RequireAuth><NewSitePage /></RequireAuth>} />
        <Route path="/admin/provision" element={<RequireAuth><NewSitePage /></RequireAuth>} />
        <Route path="/trust" element={<RequireAuth><TrustConsolePage /></RequireAuth>} />
        <Route path="/s/:slug/*" element={<RequireAuth><SiteRoute /></RequireAuth>} />
        <Route path="/w/:slug/*" element={<RequireAuth><WebsiteRoute /></RequireAuth>} />
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
  return (
    <BrowserRouter>
      <AppRoutes />
      <Toaster />
    </BrowserRouter>
  );
}
