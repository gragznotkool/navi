import { useRef, useState } from "react";
import type { RequestRecord } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime, shortId } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

export function AssignmentsModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const requests = useAsync(() => opsApi.requests(siteId), [siteId]);
  const assignments = useAsync(() => opsApi.assignments(siteId), [siteId]);
  const [busy, setBusy] = useState<string | null>(null);
  // One key per request, reused across retries of the same click, so a retry can never allocate twice.
  const keys = useRef(new Map<string, string>());
  const canAssign = permissions.has("assignment:create");

  const assign = async (r: RequestRecord) => {
    setBusy(r.id);
    const key = keys.current.get(r.id) ?? crypto.randomUUID();
    keys.current.set(r.id, key);
    try {
      await opsApi.assign(siteId, r.id, key);
      keys.current.delete(r.id);
      notify.success(`Stock assigned for request #${shortId(r.id)}`);
    } catch (e) {
      const err = toRequestError(e);
      if (err.status !== 0) keys.current.delete(r.id); // definitive server answer: a new attempt gets a new key
      notify.error(err.message);
    } finally {
      setBusy(null);
      requests.reload();
      assignments.reload();
    }
  };

  const approved = requests.data?.items.filter((r) => r.status === "approved") ?? [];

  return (
    <>
      <PageHeader title={page.title} subtitle="Approved requests ready for stock allocation, and assignments already made." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Approved — ready to assign">
          {requests.loading && !requests.data && <LoadingState />}
          {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
          {requests.data && (
            <DataTable
              caption="Approved requests"
              rows={approved}
              rowKey={(r) => r.id}
              emptyTitle="Nothing to assign"
              emptyHint="Approved requests appear here."
              columns={[
                { key: "id", header: "Request", render: (r) => <span className="font-medium">#{shortId(r.id)}</span> },
                { key: "qty", header: "Qty", align: "right", render: (r) => r.quantity },
                {
                  key: "a",
                  header: "",
                  render: (r) =>
                    canAssign ? (
                      <Button variant="primary" loading={busy === r.id} onClick={() => assign(r)} aria-label={`Assign stock for request ${shortId(r.id)}`}>Assign stock</Button>
                    ) : (
                      <span className="text-xs text-muted">Read-only</span>
                    ),
                },
              ]}
            />
          )}
        </Panel>
        <Panel title="Assignments">
          {assignments.loading && !assignments.data && <LoadingState />}
          {assignments.error ? <ErrorState error={assignments.error} onRetry={assignments.reload} /> : null}
          {assignments.data && (
            <DataTable
              caption="Assignments"
              rows={assignments.data}
              rowKey={(a) => a.id}
              emptyTitle="No assignments yet"
              columns={[
                { key: "id", header: "Assignment", render: (a) => <span className="font-medium">#{shortId(a.id)}</span> },
                { key: "req", header: "Request", render: (a) => `#${shortId(a.requestId)}` },
                { key: "qty", header: "Qty", align: "right", render: (a) => a.quantity },
                { key: "at", header: "Assigned", render: (a) => formatDateTime(a.createdAt) },
              ]}
            />
          )}
        </Panel>
      </div>
    </>
  );
}
