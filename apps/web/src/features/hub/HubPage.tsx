import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  DatabaseBackup,
  Layers,
  LogOut,
  PackageCheck,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

export function HubPage() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const sites = useAsync(() => sitesApi.list(), []);
  const overview = useAsync(() => opsApi.hubOverview(), []);
  const lastSlug = getLastSite();
  const last = sites.data?.find((s) => s.slug === lastSlug);

  return (
    <div className="flex min-h-full flex-col bg-[#080909] text-[#F5F5F0]">
      <OfflineBanner />
      {/* Industrial Top Command Header */}
      <header className="flex h-14 items-center justify-between border-b border-[#303432] bg-[#111313] px-6 text-[#F5F5F0] shadow-md">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-[2px] bg-[#FFE500] font-black text-[#080909] text-xs shadow-[0_0_12px_rgba(255,229,0,0.4)]">
            OH
          </span>
          <div className="flex items-center gap-2.5">
            <span className="font-['Barlow_Condensed',sans-serif] text-base font-extrabold tracking-wider uppercase text-[#F5F5F0]">
              OpsHub Command
            </span>
            <span className="rounded-[2px] border border-[#FFE500]/40 bg-[#FFE500]/10 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#FFE500] uppercase">
              MULTI-SITE FLEET
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {session?.user.isPlatformAdmin && (
            <Link
              to="/sites/new"
              className="inline-flex items-center gap-1.5 rounded-[2px] bg-[#FFE500] px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-[#080909] hover:bg-[#E8D000] transition"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> +NEW SITE
            </Link>
          )}
          {session?.user.isPlatformAdmin && (
            <Link
              to="/trust"
              className="inline-flex items-center gap-1.5 font-mono text-xs text-[#A5A8A6] hover:text-[#FFE500] transition"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#FFE500]" aria-hidden /> TRUST CONSOLE
            </Link>
          )}
          <span className="font-mono text-xs text-[#777C79]">{session?.user.displayName}</span>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="inline-flex items-center gap-1.5 rounded-[2px] border border-[#303432] bg-[#171919] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#FF5C5C] hover:bg-[#FF5C5C]/10 transition"
          >
            <LogOut className="h-3 w-3" aria-hidden /> EXIT
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl p-6 sm:p-8">
        {/* Banner Section */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#303432] pb-6">
          <div>
            <div className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-[#FFE500]">
              <span className="h-1.5 w-1.5 bg-[#FFE500]" />
              COMMAND CENTER · MULTI-BUSINESS TELEMETRY
            </div>
            <h1 className="font-['Barlow_Condensed',sans-serif] text-3xl font-black uppercase tracking-wider text-[#F5F5F0]">
              Industrial Operations Fleet
            </h1>
            <p className="mt-1 text-xs text-[#A5A8A6]">
              Real-time synchronization across Central Stores, Service Centre, and Distribution sites.
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs text-[#777C79]">
            <span className="h-2 w-2 rounded-full bg-[#39D98A] animate-pulse" />
            SYSTEM STATUS: <span className="font-bold text-[#39D98A]">ONLINE</span>
          </div>
        </div>

        {/* Cross-site Overview Section */}
        {overview.loading && !overview.data && <LoadingState label="Polling operational fleet telemetry…" />}
        {overview.error ? (
          <div className="mb-6">
            <ErrorState error={overview.error} onRetry={overview.reload} />
          </div>
        ) : null}
        {overview.data && (
          <section className="mb-8" aria-labelledby="hub-kpi-heading">
            <div className="mb-3 flex items-center justify-between font-mono text-xs uppercase tracking-wider text-[#A5A8A6]">
              <h2 id="hub-kpi-heading" className="font-bold text-[#FFE500]">
                // FLEET METRICS TELEMETRY
              </h2>
              <span className="text-[#777C79]">DATA SOURCE: REPLICATED NODES</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiTile
                icon={Layers}
                label="Active sites"
                value={overview.data.totals.sites}
              />
              <KpiTile
                icon={ClipboardList}
                label="Pending requests"
                value={overview.data.totals.pendingRequests}
              />
              <KpiTile
                icon={ClipboardCheck}
                label="Awaiting approval"
                value={overview.data.totals.pendingApprovals}
              />
              <KpiTile
                icon={Boxes}
                label="Stock lines"
                value={overview.data.totals.inventoryItems}
              />
              <KpiTile
                icon={Boxes}
                label="Units on hand"
                value={overview.data.totals.stockUnits}
              />
              <KpiTile
                icon={PackageCheck}
                label="Assignments"
                value={overview.data.totals.outstandingAssignments}
              />
            </div>

            {overview.data.sites.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-[3px] border border-[#303432] bg-[#171919]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#303432] bg-[#111313] font-mono text-[11px] font-semibold uppercase tracking-wider text-[#A5A8A6]">
                    <tr>
                      <th className="px-4 py-2.5">Site / Unit</th>
                      <th className="px-4 py-2.5 text-right">Requests</th>
                      <th className="px-4 py-2.5 text-right">Approvals</th>
                      <th className="px-4 py-2.5 text-right">Stock Lines</th>
                      <th className="px-4 py-2.5 text-right">Assignments</th>
                      <th className="px-4 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202422]">
                    {overview.data.sites.map((s) => (
                      <tr key={s.siteId} className="hover:bg-[#1f2222] transition-colors">
                        <td className="px-4 py-2.5 font-medium text-[#F5F5F0]">
                          <Link to={`/s/${s.slug}`} className="font-['Barlow_Condensed',sans-serif] text-sm font-bold uppercase tracking-wide text-[#F5F5F0] hover:text-[#FFE500]">
                            {s.name}
                          </Link>
                          <span className="block font-mono text-[10px] text-[#777C79]">NODE: /{s.slug}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#A5A8A6]">{s.pendingRequests}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#FFE500] font-bold">{s.pendingApprovals}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#A5A8A6]">{s.inventoryItems}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#A5A8A6]">{s.outstandingAssignments}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            to={`/s/${s.slug}`}
                            className="inline-block rounded-[2px] border border-[#303432] bg-[#111313] px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-[#FFE500] hover:bg-[#FFE500] hover:text-[#080909] transition"
                          >
                            CONNECT →
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
          <Link to={`/s/${last.slug}`} className="mb-6 flex items-center justify-between rounded-[4px] border border-[#FFE500]/40 bg-[#111313] px-4 py-3 font-mono text-xs text-[#F5F5F0] transition hover:border-[#FFE500] hover:shadow-[0_0_15px_rgba(255,229,0,0.15)]">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 bg-[#FFE500]" />
              RESUME WORKSPACE: <strong className="font-bold text-[#FFE500]">{last.name}</strong>
            </span>
            <span aria-hidden className="text-[#A5A8A6]">ENTER NODE WORKSPACE →</span>
          </Link>
        )}

        {/* Sites List Section */}
        <section aria-labelledby="sites-heading">
          <div className="mb-3 flex items-center justify-between font-mono text-xs uppercase tracking-wider text-[#A5A8A6]">
            <h2 id="sites-heading" className="font-bold text-[#F5F5F0]">
              // DEPLOYED SITES ({sites.data?.length ?? 0})
            </h2>
            <span className="text-[#777C79]">ISOLATED TENANT WORKSPACES</span>
          </div>
          {sites.loading && <LoadingState />}
          {sites.error ? <ErrorState error={sites.error} onRetry={sites.reload} /> : null}
          {sites.data && sites.data.length === 0 && (
            <EmptyState title="No sites assigned" hint="Ask a platform administrator to add you to a site." />
          )}
          {sites.data && sites.data.length > 0 && (
            <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {sites.data.map((s) => (
                <li
                  key={s.id}
                  className="group flex flex-col justify-between rounded-[4px] border border-[#303432] bg-[#171919] p-4 shadow-sm transition hover:border-[#FFE500] hover:shadow-[0_0_15px_rgba(255,229,0,0.1)]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 border-b border-[#303432] pb-2.5">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-2 w-2 bg-[#FFE500]" />
                        <h3 className="font-['Barlow_Condensed',sans-serif] text-base font-black uppercase tracking-wider text-[#F5F5F0] group-hover:text-[#FFE500] transition-colors">{s.name}</h3>
                      </div>
                      <Badge tone="yellow">v{s.activeReleaseVersion ?? "1"}</Badge>
                    </div>
                    <div className="mt-3 grid gap-1 font-mono text-[11px]">
                      <p className="text-[#777C79]">
                        NODE: <span className="text-[#F5F5F0]">/{s.slug}</span>
                      </p>
                      <p className="text-[#777C79]">
                        SHELL: <span className="font-bold text-[#FFE500] uppercase">{s.shell}</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#303432]">
                    <Link
                      to={`/s/${s.slug}`}
                      className="block w-full rounded-[2px] bg-[#111313] border border-[#303432] py-2 text-center font-mono text-xs font-bold uppercase tracking-wider text-[#FFE500] transition hover:bg-[#FFE500] hover:text-[#080909] active:scale-[0.99]"
                    >
                      ENTER WORKSPACE →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Platform Admin Backup (Feature 10) */}
        {session?.user.isPlatformAdmin && <BackupPanel />}
      </main>
    </div>
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
    <div className="rounded-[4px] border border-[#303432] bg-[#171919] p-3 shadow-sm transition hover:border-[#FFE500]/50">
      <div className="flex items-center justify-between text-[#A5A8A6]">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#777C79]">{label}</span>
        <div className="flex h-5 w-5 items-center justify-center rounded-[2px] border border-[#FFE500]/30 bg-[#FFE500]/10 text-[#FFE500]">
          <Icon className="h-3 w-3" />
        </div>
      </div>
      <p className="mt-2 font-mono text-2xl font-black tracking-tight text-[#F5F5F0] tabular-nums">
        {Number(value).toLocaleString()}
      </p>
    </div>
  );
}
