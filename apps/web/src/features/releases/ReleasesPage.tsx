import { useState } from "react";
import { Activity, Clock, GitCommit, List, Shield, User } from "lucide-react";
import type { ReleaseDiff, ReleaseSummary } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Badge, Button, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime, shortId } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import { releasesApi } from "../../services";
import { notify } from "../../stores/toast";
import { ImpactDialog } from "./ImpactDialog";

export function ReleasesPage() {
  const { siteId, reload } = useSiteRuntime();
  const releases = useAsync(() => releasesApi.list(siteId), [siteId]);
  const audit = useAsync(() => releasesApi.audit(siteId), [siteId]);
  const [diff, setDiff] = useState<ReleaseDiff | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [target, setTarget] = useState<ReleaseSummary | null>(null);
  const [summary, setSummary] = useState<{ version: number; sentences: string[] } | null>(null);
  const [auditView, setAuditView] = useState<"timeline" | "table">("timeline");
  const active = releases.data?.find((r) => r.isActive);

  const showDiff = async (r: ReleaseSummary) => {
    try {
      setDiff(await releasesApi.diff(siteId, r.id));
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  };
  const showSummary = async (r: ReleaseSummary) => {
    try {
      setSummary(await releasesApi.summary(siteId, r.id));
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  };
  const rollback = async (r: ReleaseSummary, confirmDestructive: boolean) => {
    if (!active) return;
    setBusy(r.version);
    try {
      const created = await releasesApi.rollback(siteId, { targetVersion: r.version, baseVersion: active.version, ...(confirmDestructive ? { confirmDestructive: true } : {}) });
      setTarget(null);
      notify.success(`Rolled back to v${r.version} as new release v${created.version}`);
      releases.reload();
      audit.reload();
      reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Releases" subtitle="Published releases are immutable. Rolling back publishes a new release; history is never deleted." />
      {releases.loading && !releases.data && <LoadingState />}
      {releases.error ? <ErrorState error={releases.error} onRetry={releases.reload} /> : null}
      {releases.data && (
        <DataTable
          caption="Release history"
          rows={releases.data}
          rowKey={(r) => r.id}
          columns={[
            { key: "v", header: "Version", render: (r) => <span className="font-medium">v{r.version}</span> },
            { key: "s", header: "Status", render: (r) => (r.isActive ? <Badge tone="success">Active</Badge> : <Badge>Superseded</Badge>) },
            { key: "n", header: "Note", render: (r) => r.note ?? "—" },
            { key: "rb", header: "Rollback of", render: (r) => (r.rolledBackToVersion ? `v${r.rolledBackToVersion}` : "—") },
            { key: "at", header: "Published", render: (r) => formatDateTime(r.publishedAt) },
            {
              key: "a",
              header: "",
              render: (r) => (
                <div className="flex gap-2">
                  <Button onClick={() => showSummary(r)} aria-label={`Explain version ${r.version} in plain English`}>What changed</Button>
                  <Button onClick={() => showDiff(r)} aria-label={`Show changes in version ${r.version}`}>Technical diff</Button>
                  <Button disabled={r.isActive} loading={busy === r.version} onClick={() => setTarget(r)} aria-label={`Roll back to version ${r.version}`}>Roll back to this</Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {target && active && (
        <ImpactDialog
          siteId={siteId}
          title={`Roll back to v${target.version}?`}
          confirmLabel="Roll back"
          busy={busy === target.version}
          request={{ baseVersion: active.version, targetVersion: target.version }}
          onConfirm={(confirm) => void rollback(target, confirm)}
          onClose={() => setTarget(null)}
        />
      )}
      {summary && (
        <div className="mt-4">
          <Panel title={`What changed in v${summary.version}`} actions={<Button variant="ghost" onClick={() => setSummary(null)}>Close</Button>}>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {summary.sentences.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </Panel>
        </div>
      )}
      {diff && (
        <div className="mt-4">
          <Panel title={`Changes in v${diff.toVersion}${diff.fromVersion ? ` vs v${diff.fromVersion}` : ""}`} actions={<Button variant="ghost" onClick={() => setDiff(null)}>Close</Button>}>
            {diff.entries.length === 0 ? (
              <p className="text-sm text-muted">No differences.</p>
            ) : (
              <ul className="max-h-72 overflow-auto text-sm">
                {diff.entries.map((e) => (
                  <li key={e.path} className="flex gap-2 py-0.5">
                    <Badge tone={e.change === "added" ? "success" : e.change === "removed" ? "danger" : "warning"}>{e.change}</Badge>
                    <code className="text-xs">{e.path || "(root)"}</code>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
      <div className="mt-4">
        <Panel
          title="Cryptographic Audit Trail"
          actions={
            <div className="flex items-center gap-1 rounded-full border-2 border-[#1E293B] bg-slate-100 p-0.5 dark:border-[#334155] dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setAuditView("timeline")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase transition ${
                  auditView === "timeline"
                    ? "bg-[#FBBC04] text-[#0F172A] shadow-[1px_1px_0px_#1E293B]"
                    : "text-slate-600 hover:text-[#0F172A] dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                <Activity className="h-3 w-3" /> Timeline
              </button>
              <button
                type="button"
                onClick={() => setAuditView("table")}
                className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase transition ${
                  auditView === "table"
                    ? "bg-[#FBBC04] text-[#0F172A] shadow-[1px_1px_0px_#1E293B]"
                    : "text-slate-600 hover:text-[#0F172A] dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                <List className="h-3 w-3" /> Table
              </button>
            </div>
          }
        >
          {audit.loading && <LoadingState />}
          {audit.error ? <ErrorState error={audit.error} onRetry={audit.reload} /> : null}
          {audit.data && auditView === "timeline" && (
            <div className="py-2">
              {audit.data.length === 0 ? (
                <p className="text-center font-mono text-xs text-slate-500 py-6">No audit records logged yet</p>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                  {[...audit.data].reverse().map((e, idx) => {
                    const isRelease = e.action.includes("release") || e.action.includes("publish");
                    const isRollback = e.action.includes("rollback") || e.action.includes("rewind");

                    const badgeColor = isRelease
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700"
                      : isRollback
                        ? "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-700"
                        : "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-700";

                    return (
                      <div key={e.id || idx} className="relative group">
                        {/* Timeline Node Dot */}
                        <div
                          className={`absolute -left-[19px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#1E293B] shadow-[1px_1px_0px_#1E293B] ${
                            isRelease ? "bg-[#34A853]" : isRollback ? "bg-[#EA4335]" : "bg-[#4285F4]"
                          }`}
                        />

                        <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-3 shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-[#1A243B] transition hover:-translate-y-0.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-wider ${badgeColor}`}>
                              {e.action}
                            </span>
                            <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                              <Clock className="h-3 w-3" /> {formatDateTime(e.createdAt)}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center justify-between font-mono text-xs text-slate-700 dark:text-slate-300">
                            <span>
                              Entity: <strong className="text-[#0F172A] dark:text-white">{e.entityType}</strong> {e.entityId && `(#${shortId(e.entityId)})`}
                            </span>
                            {e.actorId && (
                              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                                <User className="h-3 w-3" /> Actor #{shortId(e.actorId)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {audit.data && auditView === "table" && (
            <DataTable
              caption="Audit events"
              rows={[...audit.data].reverse()}
              rowKey={(e) => e.id}
              emptyTitle="No audit events"
              columns={[
                { key: "at", header: "When", render: (e) => formatDateTime(e.createdAt) },
                { key: "act", header: "Action", render: (e) => e.action },
                { key: "ent", header: "Entity", render: (e) => e.entityType },
                { key: "actor", header: "Actor", render: (e) => (e.actorId ? `#${shortId(e.actorId)}` : "System") },
              ]}
            />
          )}
        </Panel>
      </div>
    </>
  );
}
