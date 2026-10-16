import { LogOut, Plus, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from "../../components/feedback";
import { Badge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { sitesApi } from "../../services";
import { getLastSite } from "../../stores/lastSite";
import { useSession } from "../../stores/session";

export function HubPage() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const sites = useAsync(() => sitesApi.list(), []);
  const lastSlug = getLastSite();
  const last = sites.data?.find((s) => s.slug === lastSlug);

  return (
    <div className="flex min-h-full flex-col">
      <OfflineBanner />
      <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <span className="text-sm font-semibold">OpsHub</span>
        <div className="flex items-center gap-3">
          {session?.user.isPlatformAdmin && (
            <Link to="/sites/new" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden /> New site</Link>
          )}
          {session?.user.isPlatformAdmin && (
            <Link to="/trust" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Trust console</Link>
          )}
          <span className="text-xs text-muted">{session?.user.displayName}</span>
          <button onClick={async () => { await logout(); navigate("/login"); }} className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"><LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out</button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-lg font-semibold">Your sites</h1>
        <p className="mb-4 mt-0.5 text-sm text-muted">Each site runs its own published configuration.</p>
        {sites.loading && <LoadingState />}
        {sites.error ? <ErrorState error={sites.error} onRetry={sites.reload} /> : null}
        {sites.data && sites.data.length === 0 && <EmptyState title="No sites assigned" hint="Ask a platform administrator to add you to a site." />}
        {last && (
          <Link to={`/s/${last.slug}`} className="mb-3 flex items-center justify-between rounded-ui border border-line bg-surface px-4 py-2.5 text-sm hover:bg-slate-50">
            <span>Continue where you left off: <strong>{last.name}</strong></span>
            <span aria-hidden>→</span>
          </Link>
        )}
        {sites.data && sites.data.length > 0 && (
          <ul className="divide-y divide-line rounded-ui border border-line bg-surface">
            {sites.data.map((s) => (
              <li key={s.id}>
                <Link to={`/s/${s.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span aria-hidden className="h-8 w-1 rounded" style={{ background: s.accent }} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-muted">{s.slug} · {s.shell} shell</span>
                  </span>
                  <Badge>release v{s.activeReleaseVersion ?? "—"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
