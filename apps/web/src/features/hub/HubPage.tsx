import { GitBranch, History, LogOut, Plus, Rewind, ShieldCheck } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from "../../components/feedback";
import { Badge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { sitesApi } from "../../services";
import { getLastSite } from "../../stores/lastSite";
import { useSession } from "../../stores/session";

const tab = ({ isActive }: { isActive: boolean }) =>
  `inline-flex h-full items-center border-b-2 px-3 text-sm font-medium ${isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`;

/** `/`, `/hub` and `/hub/sites` show the site list; `/hub/builder` lists the sites whose configuration the user can change. */
export function HubPage({ view = "sites" }: { view?: "sites" | "builder" }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const sites = useAsync(() => sitesApi.list(), []);
  const lastSlug = getLastSite();
  const last = sites.data?.find((s) => s.slug === lastSlug);

  return (
    <div className="flex min-h-full flex-col">
      <OfflineBanner />
      <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex h-full items-center gap-4">
          <span className="text-sm font-semibold">OpsHub</span>
          <nav aria-label="Hub" className="flex h-full items-stretch">
            <NavLink to="/hub/sites" className={tab}>Sites</NavLink>
            <NavLink to="/hub/builder" className={tab}>Builder</NavLink>
          </nav>
        </div>
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
      {view === "builder" ? <BuilderEntry /> : (
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
      )}
    </div>
  );
}

/** Builder entry: every site the user may reconfigure, with a direct path to the builder, releases and rewind. */
function BuilderEntry() {
  const session = useSession((s) => s.session);
  const sites = useAsync(() => sitesApi.list(), []);
  const manageable = new Set(session?.memberships.filter((m) => m.permissions.includes("config:manage")).map((m) => m.siteSlug));
  const rows = sites.data?.filter((s) => manageable.has(s.slug)) ?? [];
  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <h1 className="text-lg font-semibold">Configuration builder</h1>
      <p className="mb-4 mt-0.5 text-sm text-muted">Choose a site to change its modules, fields and roles. Nothing changes until you publish.</p>
      {sites.loading && <LoadingState />}
      {sites.error ? <ErrorState error={sites.error} onRetry={sites.reload} /> : null}
      {sites.data && rows.length === 0 && <EmptyState title="No sites you can configure" hint="Ask a platform administrator for configuration access." />}
      {rows.length > 0 && (
        <ul className="divide-y divide-line rounded-ui border border-line bg-surface" aria-label="Sites you can configure">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span aria-hidden className="h-8 w-1 rounded" style={{ background: s.accent }} />
              <span className="flex-1">
                <span className="block text-sm font-medium">{s.name}</span>
                <span className="block text-xs text-muted">{s.slug} · release v{s.activeReleaseVersion ?? "—"}</span>
              </span>
              <Link to={`/s/${s.slug}/admin/builder`} className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"><GitBranch className="h-4 w-4" aria-hidden /> Open builder</Link>
              <Link to={`/s/${s.slug}/admin/releases`} className="inline-flex items-center gap-1.5 text-sm hover:underline"><History className="h-4 w-4" aria-hidden /> Releases</Link>
              <Link to={`/s/${s.slug}/admin/rewind`} className="inline-flex items-center gap-1.5 text-sm hover:underline"><Rewind className="h-4 w-4" aria-hidden /> Rewind</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
