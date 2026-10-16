import { useState } from "react";
import type { RequestRecord } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader, StatusBadge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime, shortId, totalQuantity } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

export function ApprovalsModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const requests = useAsync(() => opsApi.requests(siteId), [siteId]);
  const [busy, setBusy] = useState<string | null>(null);
  const canDecide = permissions.has("approval:decide");

  const decide = async (r: RequestRecord, decision: "approved" | "rejected") => {
    setBusy(r.id);
    try {
      await opsApi.decide(siteId, r.id, decision);
      notify.success(`Request #${shortId(r.id)} ${decision}`);
      requests.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
      requests.reload();
    } finally {
      setBusy(null);
    }
  };

  const pending = requests.data?.items.filter((r) => r.status === "submitted") ?? [];

  return (
    <>
      <PageHeader title={page.title} subtitle="Submitted requests awaiting a decision." />
      {requests.loading && !requests.data && <LoadingState />}
      {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
      {requests.data && (
        <DataTable
          caption="Approval queue"
          rows={pending}
          rowKey={(r) => r.id}
          emptyTitle="The approval queue is empty"
          emptyHint="Newly submitted requests will appear here."
          columns={[
            { key: "id", header: "Request", render: (r) => <span className="font-medium">#{shortId(r.id)}</span> },
            { key: "qty", header: "Qty", align: "right", render: (r) => totalQuantity(r) },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "created", header: "Submitted", render: (r) => formatDateTime(r.createdAt) },
            {
              key: "actions",
              header: "Decision",
              render: (r) =>
                canDecide ? (
                  <div className="flex gap-2">
                    <Button variant="primary" loading={busy === r.id} onClick={() => decide(r, "approved")} aria-label={`Approve request ${shortId(r.id)}`}>Approve</Button>
                    <Button disabled={busy === r.id} onClick={() => decide(r, "rejected")} aria-label={`Reject request ${shortId(r.id)}`}>Reject</Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted">Read-only for your role</span>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
