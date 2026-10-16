import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LoadingState, Toaster } from "../components/feedback";
import { LoginPage } from "../features/auth/LoginPage";
import { HubPage } from "../features/hub/HubPage";
import { TrustConsolePage } from "../features/security-console/TrustConsolePage";
import { SiteRoute } from "../runtime/SiteRoutes";
import { useSession } from "../stores/session";
import { EmptyState } from "../components/feedback";

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RequireAuth><HubPage /></RequireAuth>} />
      <Route path="/trust" element={<RequireAuth><TrustConsolePage /></RequireAuth>} />
      <Route path="/s/:slug/*" element={<RequireAuth><SiteRoute /></RequireAuth>} />
      <Route path="/preview/:slug/*" element={<RequireAuth><SiteRoute preview /></RequireAuth>} />
      <Route path="*" element={<div className="p-8"><EmptyState title="Page not found" hint="That address does not exist." /></div>} />
    </Routes>
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
