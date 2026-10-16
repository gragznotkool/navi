import { useState } from "react";
import { createRepairPayloadSchema, type RepairRecord, type RepairStatus } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader, Panel, StatusBadge, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { repairsApi } from "../../services";
import { notify } from "../../stores/toast";

const NEXT: Record<RepairStatus, { to: RepairStatus; label: string }[]> = {
  received: [{ to: "diagnosing", label: "Start diagnosis" }],
  diagnosing: [{ to: "repairing", label: "Start repair" }, { to: "scrapped", label: "Scrap" }],
  repairing: [{ to: "testing", label: "Send to test" }],
  testing: [{ to: "completed", label: "Complete" }, { to: "repairing", label: "Back to repair" }],
  completed: [],
  scrapped: [],
};

/** Boards through the repair workflow: received, diagnosing, repairing, testing, then completed or scrapped. */
export function RepairsModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const canUpdate = permissions.has("repair:update");
  const repairs = useAsync(() => repairsApi.list(siteId), [siteId]);
  const [serial, setSerial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const receive = async () => {
    const parsed = createRepairPayloadSchema.safeParse({ boardSerial: serial });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the serial");
    setError(null);
    setBusy("new");
    try {
      await repairsApi.create(siteId, parsed.data);
      notify.success(`Board ${parsed.data.boardSerial} received`);
      setSerial("");
      repairs.reload();
    } catch (e) {
      setError(toRequestError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const move = async (r: RepairRecord, to: RepairStatus) => {
    setBusy(r.id + to);
    try {
      await repairsApi.transition(siteId, r.id, to);
      notify.success(`${r.boardSerial}: ${to}`);
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(null);
      repairs.reload();
    }
  };

  return (
    <>
      <PageHeader title={page.title} subtitle="Track each board from arrival to completion. Steps follow a fixed workflow and the technician is recorded." />
      {canUpdate && (
        <div className="mb-4">
          <Panel title="Receive a board">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void receive(); }} noValidate>
              <div className="w-64"><TextField label="Board serial" value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={64} {...(error ? { error } : {})} /></div>
              <Button type="submit" variant="primary" loading={busy === "new"}>Receive board</Button>
            </form>
          </Panel>
        </div>
      )}
      {repairs.loading && !repairs.data && <LoadingState />}
      {repairs.error ? <ErrorState error={repairs.error} onRetry={repairs.reload} /> : null}
      {repairs.data && (
        <DataTable
          caption="Repairs"
          rows={repairs.data}
          rowKey={(r) => r.id}
          emptyTitle="No boards received yet"
          columns={[
            { key: "serial", header: "Board serial", render: (r) => <span className="font-medium">{r.boardSerial}</span> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "when", header: "Received", render: (r) => formatDateTime(r.createdAt) },
            {
              key: "act",
              header: "Next step",
              render: (r) =>
                canUpdate && NEXT[r.status].length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {NEXT[r.status].map((n) => (
                      <Button key={n.to} variant={n.to === "scrapped" ? "secondary" : "primary"} loading={busy === r.id + n.to} disabled={busy !== null} onClick={() => void move(r, n.to)} aria-label={`${n.label}: ${r.boardSerial}`}>{n.label}</Button>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted">{NEXT[r.status].length === 0 ? "Finished" : "Read-only for your role"}</span>
                ),
            },
          ]}
        />
      )}
    </>
  );
}
