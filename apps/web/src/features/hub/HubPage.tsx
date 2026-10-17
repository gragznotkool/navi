import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  DatabaseBackup,
  GitBranch,
  History,
  Layers,
  LogOut,
  PackageCheck,
  Plus,
  Rewind,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from "../../components/feedback";
import { Badge, Button, Panel } from "../../components/ui";
import { saveBlob, toRequestError } from "../../lib/api";
import { useAsync } from "../../hooks/useAsync";
import { hubApi, opsApi, sitesApi } from "../../services";
import { getLastSite } from "../../stores/lastSite";
import { useSession } from "../../stores/session";
import { notify } from "../../stores/toast";

function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { blob, fileName } = await hubApi.backup();
      saveBlob(blob, fileName);
      notify.success(`Backup downloaded: ${fileName} (${(blob.size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-8">
      <Panel title="Hub administration">
        <p className="mb-3 text-sm text-muted">
          Streams a live <code>pg_dump</code> (custom format) of the whole database. Restore it with{" "}
          <code>scripts/restore.sh</code>. Each download is audited.
        </p>
        <Button onClick={download} loading={busy}>
          {!busy && <DatabaseBackup className="h-4 w-4 mr-1.5" aria-hidden />} Download Production Backup
        </Button>
      </Panel>
    </div>
  );
}

const tab = ({ isActive }: { isActive: boolean }) =>
  `inline-flex h-full items-center border-b-2 px-3 text-sm font-medium ${isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`;

/** `/`, `/hub` and `/hub/sites` show the site list; `/hub/builder` lists the sites whose configuration the user can change. */
export function HubPage({ view = "sites" }: { view?: "sites" | "builder" }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const sites = useAsync(() => sitesApi.list(), []);
  const overview = useAsync(() => opsApi.hubOverview(), []);
  const lastSlug = getLastSite();
  const last = sites.data?.find((s) => s.slug === lastSlug);

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <OfflineBanner />
      <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex h-full items-center gap-4">
          <span className="text-sm font-semibold">OpsHub Enterprise</span>
          <nav aria-label="Hub" className="flex h-full items-stretch">
            <NavLink to="/hub/sites" className={tab}>Sites</NavLink>
            <NavLink to="/hub/builder" className={tab}>Builder</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {session?.user.isPlatformAdmin && (
            <Link to="/sites/new" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline">
              <Plus className="h-3.5 w-3.5" aria-hidden /> New site
            </Link>
          )}
          {session?.user.isPlatformAdmin && (
            <Link to="/trust" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Trust console
            </Link>
          )}
          <span className="text-xs font-medium text-muted">{session?.user.displayName}</span>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 hover:underline"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
          </button>
        </div>
      </header>

      {view === "builder" ? (
        <BuilderEntry />
      ) : (
        <main className="mx-auto w-full max-w-5xl p-6 sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold tracking-tight text-ink">Operations Hub</h1>
            <p className="mt-0.5 text-sm text-muted">
              Aggregated metrics across your sites and quick navigation to active runtime shells.
            </p>
          </div>

          {/* Cross-site Overview Section */}
          {overview.loading && !overview.data && <LoadingState label="Loading operational overview…" />}
          {overview.error ? (
            <div className="mb-6">
              <ErrorState error={overview.error} onRetry={overview.reload} />
            </div>
          ) : null}
          {overview.data && (
            <section className="mb-8" aria-labelledby="hub-kpi-heading">
              <h2 id="hub-kpi-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                Fleet Overview
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <KpiTile icon={Layers} label="Active sites" value={overview.data.totals.sites} />
                <KpiTile icon={ClipboardList} label="Pending requests" value={overview.data.totals.pendingRequests} />
                <KpiTile icon={ClipboardCheck} label="Awaiting approval" value={overview.data.totals.pendingApprovals} />
                <KpiTile icon={Boxes} label="Stock lines" value={overview.data.totals.inventoryItems} />
                <KpiTile icon={Boxes} label="Units on hand" value={overview.data.totals.stockUnits} />
                <KpiTile icon={PackageCheck} label="Assignments" value={overview.data.totals.outstandingAssignments} />
              </div>

              {overview.data.sites.length > 0 && (
                <div className="mt-4 overflow-hidden rounded-ui border border-line bg-surface shadow-xs">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-line bg-slate-50 text-muted">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Site Name</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Requests</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Approvals</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Stock Lines</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Assignments</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {overview.data.sites.map((s) => (
                        <tr key={s.siteId} className="hover:bg-slate-50/80">
                          <td className="px-4 py-2.5 font-medium text-ink">
                            <Link to={`/s/${s.slug}`} className="hover:text-accent hover:underline">
                              {s.name}
                            </Link>
                            <span className="block text-[11px] text-muted">/{s.slug}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{s.pendingRequests}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{s.pendingApprovals}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{s.inventoryItems}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{s.outstandingAssignments}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Link
                              to={`/s/${s.slug}`}
                              className="inline-block rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:bg-slate-100"
                            >
                              Open →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {last && (
            <Link to={`/s/${last.slug}`} className="mb-6 flex items-center justify-between rounded-ui border border-line bg-surface px-4 py-3 text-sm shadow-xs hover:border-slate-400">
              <span>Continue where you left off: <strong className="text-ink">{last.name}</strong></span>
              <span aria-hidden className="text-muted">Open site workspace →</span>
            </Link>
          )}

          {/* Sites List Section */}
          <section aria-labelledby="sites-heading">
            <h2 id="sites-heading" className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Configured Sites
            </h2>
            {sites.loading && <LoadingState />}
            {sites.error ? <ErrorState error={sites.error} onRetry={sites.reload} /> : null}
            {sites.data && sites.data.length === 0 && (
              <EmptyState title="No sites assigned" hint="Ask a platform administrator to add you to a site." />
            )}
            {sites.data && sites.data.length > 0 && (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sites.data.map((s) => (
                  <li
                    key={s.id}
                    className="group flex flex-col justify-between rounded-ui border border-line bg-surface p-4 shadow-xs transition hover:border-slate-400 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: s.accent }} />
                          <h3 className="text-sm font-semibold text-ink group-hover:text-accent">
                            <Link to={`/s/${s.slug}`} className="hover:underline">
                              {s.name}
                            </Link>
                          </h3>
                        </div>
                        <Badge>release v{s.activeReleaseVersion ?? "—"}</Badge>
                      </div>
                      <p className="mt-1.5 text-xs text-muted">
                        Slug: <span className="font-mono text-ink">{s.slug}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted capitalize">
                        Shell: <span className="font-medium text-ink">{s.shell}</span>
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-line">
                      <Link
                        to={`/s/${s.slug}`}
                        className="block w-full rounded-ui bg-slate-900 py-1.5 text-center text-xs font-semibold text-white transition hover:bg-accent"
                      >
                        Enter site workspace
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Platform Admin Backup */}
          {session?.user.isPlatformAdmin && <BackupPanel />}
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

function KpiTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-ui border border-line bg-surface p-3 shadow-xs">
      <div className="flex items-center justify-between text-muted">
        <span className="text-[11px] font-medium leading-none">{label}</span>
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </div>
      <p className="mt-2 text-xl font-bold tracking-tight text-ink tabular-nums">
        {Number(value).toLocaleString()}
      </p>
    </div>
  );
}
