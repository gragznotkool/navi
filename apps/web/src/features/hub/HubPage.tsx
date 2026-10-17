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
    <div className="flex min-h-full flex-col industrial-dot-grid text-[#0F172A]">
      <OfflineBanner />
      {/* DevFest Playful Top Command Header */}
      <header className="flex h-16 items-center justify-between border-b-2 border-[#1E293B] bg-white px-6 shadow-[0_2px_0px_#1E293B]">
        <div className="flex items-center gap-3">
          <img
            src="/navi-logo.png"
            alt="NAVI"
            className="h-9 w-auto object-contain rounded-md border border-[#1E293B] shadow-[2px_2px_0px_#1E293B]"
          />
          <div className="flex items-center gap-2.5">
            <span className="font-['Outfit',sans-serif] text-lg font-black tracking-wide uppercase text-[#0F172A]">
              NAVI Command
            </span>
            <span className="rounded-full border-2 border-[#1E293B] bg-[#FBBC04] px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#0F172A] uppercase shadow-[1px_1px_0px_#1E293B]">
              MULTI-SITE FLEET
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {session?.user.isPlatformAdmin && (
            <Link
              to="/sites/new"
              className="devfest-btn inline-flex items-center gap-1.5 rounded-full bg-[#FBBC04] px-3.5 py-1.5 font-mono text-xs font-bold text-[#0F172A] hover:bg-[#F59E0B]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> +NEW SITE
            </Link>
          )}
          {session?.user.isPlatformAdmin && (
            <Link
              to="/trust"
              className="devfest-btn inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-mono text-xs font-bold text-[#0F172A] hover:bg-slate-50"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#34A853]" aria-hidden /> TRUST CONSOLE
            </Link>
          )}
          <span className="hidden font-mono text-xs font-bold text-slate-600 sm:inline">{session?.user.displayName}</span>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="devfest-btn inline-flex items-center gap-1.5 rounded-full bg-[#EA4335] px-3 py-1.5 font-mono text-xs font-bold text-white hover:bg-red-600"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> EXIT
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl p-6 sm:p-8">
        {/* Banner Section */}
        <div className="devfest-card mb-8 p-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-1.5 inline-flex items-center gap-2 rounded-full bg-[#3B82F6]/15 px-3 py-1 font-mono text-xs font-bold text-[#2563EB]">
              <span className="h-2 w-2 rounded-full bg-[#2563EB]" />
              COMMAND CENTER · MULTI-BUSINESS TELEMETRY
            </div>
            <h1 className="font-['Outfit',sans-serif] text-3xl font-black tracking-tight text-[#0F172A]">
              Industrial Operations Fleet
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Real-time synchronization across Central Stores, Service Centre, and Distribution sites.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border-2 border-[#1E293B] bg-[#34A853]/15 px-3 py-1.5 font-mono text-xs font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#34A853] animate-pulse" />
            SYSTEM STATUS: <span className="font-extrabold text-[#34A853]">ONLINE</span>
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
            <div className="mb-3 flex items-center justify-between font-mono text-xs uppercase tracking-wider text-white">
              <h2 id="hub-kpi-heading" className="font-bold bg-white/20 px-3 py-1 rounded-full text-white backdrop-blur-xs">
                // FLEET METRICS TELEMETRY
              </h2>
              <span className="bg-white/20 px-2.5 py-1 rounded-full text-white text-[11px]">DATA SOURCE: REPLICATED NODES</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiTile
                icon={Layers}
                label="Active sites"
                value={overview.data.totals.sites}
                tone="blue"
              />
              <KpiTile
                icon={ClipboardList}
                label="Pending requests"
                value={overview.data.totals.pendingRequests}
                tone="yellow"
              />
              <KpiTile
                icon={ClipboardCheck}
                label="Awaiting approval"
                value={overview.data.totals.pendingApprovals}
                tone="red"
              />
              <KpiTile
                icon={Boxes}
                label="Stock lines"
                value={overview.data.totals.inventoryItems}
                tone="green"
              />
              <KpiTile
                icon={Boxes}
                label="Units on hand"
                value={overview.data.totals.stockUnits}
                tone="blue"
              />
              <KpiTile
                icon={PackageCheck}
                label="Assignments"
                value={overview.data.totals.outstandingAssignments}
                tone="yellow"
              />
            </div>

            {overview.data.sites.length > 0 && (
              <div className="devfest-card mt-6 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="border-b-2 border-[#1E293B] bg-slate-100 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">
                    <tr>
                      <th className="px-4 py-3">Site / Unit</th>
                      <th className="px-4 py-3 text-right">Requests</th>
                      <th className="px-4 py-3 text-right">Approvals</th>
                      <th className="px-4 py-3 text-right">Stock Lines</th>
                      <th className="px-4 py-3 text-right">Assignments</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-[#E2E8F0]">
                    {overview.data.sites.map((s) => (
                      <tr key={s.siteId} className="hover:bg-blue-50/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-[#0F172A]">
                          <Link to={`/s/${s.slug}`} className="font-['Outfit',sans-serif] text-sm font-bold text-[#0F172A] hover:text-[#2563EB]">
                            {s.name}
                          </Link>
                          <span className="block font-mono text-[11px] text-slate-500">NODE: /{s.slug}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-slate-700">{s.pendingRequests}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-[#EA4335] font-black">{s.pendingApprovals}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-slate-700">{s.inventoryItems}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-slate-700">{s.outstandingAssignments}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/s/${s.slug}`}
                            className="devfest-btn inline-block rounded-full bg-[#FBBC04] px-3 py-1 font-mono text-[11px] font-bold uppercase text-[#0F172A] hover:bg-[#F59E0B]"
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
          <Link to={`/s/${last.slug}`} className="devfest-card mb-6 flex items-center justify-between p-4 font-mono text-xs font-bold text-[#0F172A] transition hover:bg-yellow-50">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#FBBC04] border border-[#1E293B]" />
              RESUME WORKSPACE: <strong className="font-extrabold text-[#2563EB]">{last.name}</strong>
            </span>
            <span aria-hidden className="text-[#0F172A] font-extrabold">ENTER NODE WORKSPACE →</span>
          </Link>
        )}

        {/* Sites List Section */}
        <section aria-labelledby="sites-heading">
          <div className="mb-3 flex items-center justify-between font-mono text-xs uppercase tracking-wider text-white">
            <h2 id="sites-heading" className="font-bold bg-white/20 px-3 py-1 rounded-full text-white backdrop-blur-xs">
              // DEPLOYED SITES ({sites.data?.length ?? 0})
            </h2>
            <span className="bg-white/20 px-2.5 py-1 rounded-full text-white text-[11px]">ISOLATED TENANT WORKSPACES</span>
          </div>
          {sites.loading && <LoadingState />}
          {sites.error ? <ErrorState error={sites.error} onRetry={sites.reload} /> : null}
          {sites.data && sites.data.length === 0 && (
            <EmptyState title="No sites assigned" hint="Ask a platform administrator to add you to a site." />
          )}
          {sites.data && sites.data.length > 0 && (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sites.data.map((s, idx) => {
                const accentBorder = [
                  "border-t-8 border-t-[#4285F4]",
                  "border-t-8 border-t-[#EA4335]",
                  "border-t-8 border-t-[#FBBC04]",
                  "border-t-8 border-t-[#34A853]",
                ][idx % 4];
                return (
                  <li
                    key={s.id}
                    className={`devfest-card group flex flex-col justify-between p-5 ${accentBorder}`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 border-b-2 border-slate-100 pb-3">
                        <h3 className="font-['Outfit',sans-serif] text-lg font-black tracking-wide text-[#0F172A] group-hover:text-[#2563EB] transition-colors">{s.name}</h3>
                        <Badge tone="yellow">v{s.activeReleaseVersion ?? "1"}</Badge>
                      </div>
                      <div className="mt-3 grid gap-1.5 font-mono text-xs">
                        <p className="text-slate-500">
                          NODE: <span className="font-bold text-[#0F172A]">/{s.slug}</span>
                        </p>
                        <p className="text-slate-500">
                          SHELL: <span className="font-bold text-[#2563EB] uppercase">{s.shell}</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 pt-3 border-t-2 border-slate-100">
                      <Link
                        to={`/s/${s.slug}`}
                        className="devfest-btn block w-full rounded-full bg-[#3B82F6] py-2 text-center font-mono text-xs font-bold uppercase tracking-wider text-white hover:bg-[#2563EB] active:scale-[0.99]"
                      >
                        ENTER WORKSPACE →
                      </Link>
                    </div>
                  </li>
                );
              })}
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
  tone = "blue",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "blue" | "red" | "yellow" | "green";
}) {
  const iconColor = {
    blue: "bg-[#4285F4]/15 text-[#2563EB] border-[#4285F4]",
    red: "bg-[#EA4335]/15 text-[#EA4335] border-[#EA4335]",
    yellow: "bg-[#FBBC04]/20 text-[#D97706] border-[#FBBC04]",
    green: "bg-[#34A853]/15 text-[#34A853] border-[#34A853]",
  }[tone];

  return (
    <div className="devfest-card p-4 transition">
      <div className="flex items-center justify-between text-slate-600">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <div className={`flex h-6 w-6 items-center justify-center rounded-full border ${iconColor}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <p className="mt-2 font-mono text-2xl font-black tracking-tight text-[#0F172A] tabular-nums">
        {Number(value).toLocaleString()}
      </p>
    </div>
  );
}
