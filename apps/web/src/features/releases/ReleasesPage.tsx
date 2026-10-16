import { useState } from "react";
import type { ReleaseDiff, ReleaseSummary } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Badge, Button, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import { releasesApi } from "../../services";
import { notify } from "../../stores/toast";

export function ReleasesPage() {
  const { siteId, reload } = useSiteRuntime();
  const releases = useAsync(() => releasesApi.list(siteId), [siteId]);
  const audit = useAsync(() => releasesApi.audit(siteId), [siteId]);
  const [diff, setDiff] = useState<ReleaseDiff | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const active = releases.data?.find((r) => r.isActive);

  const showDiff = async (r: ReleaseSummary) => {
    try {
      setDiff(await releasesApi.diff(siteId, r.id));
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  };
  const rollback = async (r: ReleaseSummary) => {
    if (!active) return;
    setBusy(r.version);
    try {
      const created = await releasesApi.rollback(siteId, { targetVersion: r.version, baseVersion: active.version });
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
                  <Button onClick={() => showDiff(r)} aria-label={`Show changes in version ${r.version}`}>Changes</Button>
                  <Button disabled={r.isActive} loading={busy === r.version} onClick={() => rollback(r)} aria-label={`Roll back to version ${r.version}`}>Roll back to this</Button>
                </div>
              ),
            },
          ]}
        />
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
        <Panel title="Audit trail">
          {audit.loading && <LoadingState />}
          {audit.error ? <ErrorState error={audit.error} onRetry={audit.reload} /> : null}
          {audit.data && (
            <DataTable
              caption="Audit events"
              rows={[...audit.data].reverse()}
              rowKey={(e) => e.id}
              emptyTitle="No audit events"
              columns={[
                { key: "at", header: "When", render: (e) => formatDateTime(e.createdAt) },
                { key: "act", header: "Action", render: (e) => e.action },
                { key: "ent", header: "Entity", render: (e) => e.entityType },
              ]}
            />
          )}
        </Panel>
      </div>
    </>
  );
}
