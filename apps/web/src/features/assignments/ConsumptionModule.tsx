import { useState } from "react";
import type { Assignment } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { http, toRequestError } from "../../lib/api";
import { formatDateTime, shortId } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

export function ConsumptionModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const assignments = useAsync(() => opsApi.assignments(siteId), [siteId]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const canRecord = permissions.has("consumption:record");

  const record = async (a: Assignment) => {
    const quantity = Number(qty[a.id]);
    if (!Number.isInteger(quantity) || quantity < 1) return notify.error("Enter a whole quantity of at least 1");
    setBusy(a.id);
    try {
      await http.post(`/sites/${siteId}/consumption`, { assignmentId: a.id, quantity });
      notify.success(`Recorded ${quantity} unit(s) consumed`);
      setQty((q) => ({ ...q, [a.id]: "" }));
      assignments.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title={page.title} subtitle="Record how much of each assignment has been used. The server rejects over-consumption." />
      {assignments.loading && !assignments.data && <LoadingState />}
      {assignments.error ? <ErrorState error={assignments.error} onRetry={assignments.reload} /> : null}
      {assignments.data && (
        <DataTable
          caption="Assignments available for consumption"
          rows={assignments.data}
          rowKey={(a) => a.id}
          emptyTitle="No assignments to consume"
          columns={[
            { key: "id", header: "Assignment", render: (a) => <span className="font-medium">#{shortId(a.id)}</span> },
            { key: "qty", header: "Assigned qty", align: "right", render: (a) => a.quantity },
            { key: "at", header: "Assigned", render: (a) => formatDateTime(a.createdAt) },
            {
              key: "rec",
              header: "Record consumption",
              render: (a) =>
                canRecord ? (
                  <div className="flex items-center gap-2">
                    <input aria-label={`Quantity consumed for assignment ${shortId(a.id)}`} type="number" min={1} value={qty[a.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [a.id]: e.target.value }))} className="h-9 w-24 rounded-ui border border-line px-2 text-sm" />
                    <Button variant="primary" loading={busy === a.id} onClick={() => record(a)}>Record</Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted">Read-only</span>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
