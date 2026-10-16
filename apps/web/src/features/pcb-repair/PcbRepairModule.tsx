import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  createRepairPayloadSchema,
  repairTransitions,
  type CreateRepairPayload,
  type RepairRecord,
  type RepairStatus,
} from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { RecordView } from "../../components/tables/RecordView";
import { Button, PageHeader, Panel, StatusBadge, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime, shortId } from "../../lib/format";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

const REPAIR_STATUSES: RepairStatus[] = [
  "received",
  "diagnosing",
  "repairing",
  "testing",
  "completed",
  "scrapped",
];

export function PcbRepairModule({ page, layout }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const repairs = useAsync(() => opsApi.repairs(siteId), [siteId]);
  const [logging, setLogging] = useState(false);
  const canUpdate = permissions.has("repair:update");
  const canLog = permissions.has("repair:create") || canUpdate;

  const handleTransition = async (repair: RepairRecord, toStatus: RepairStatus) => {
    try {
      await opsApi.updateRepairStatus(siteId, repair.id, toStatus);
      notify.success(`PCB ${repair.boardSerial} moved to ${toStatus}`);
      repairs.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  };

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="PCB repair queue and diagnostic status tracking across workstations."
        actions={
          canLog && (
            <Button variant="primary" onClick={() => setLogging((v) => !v)} aria-expanded={logging}>
              Log PCB for repair
            </Button>
          )
        }
      />
      {logging && (
        <div className="mb-4">
          <RepairForm
            siteId={siteId}
            onDone={() => {
              setLogging(false);
              repairs.reload();
            }}
          />
        </div>
      )}
      {repairs.loading && !repairs.data && <LoadingState />}
      {repairs.error ? <ErrorState error={repairs.error} onRetry={repairs.reload} /> : null}
      {repairs.data && (
        <RecordView<RepairRecord>
          layout={layout}
          caption="PCB Repairs"
          rows={repairs.data.items}
          rowKey={(r) => r.id}
          groupBy={(r) => r.status}
          groups={REPAIR_STATUSES}
          onMove={canUpdate ? (r, to) => handleTransition(r, to as RepairStatus) : undefined}
          emptyTitle="No repair jobs recorded"
          emptyHint={canUpdate ? "Log a PCB to initiate diagnostic triage." : undefined}
          card={(r) => {
            const nextSteps = repairTransitions[r.status] || [];
            return (
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{r.boardSerial}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-muted">Job #{shortId(r.id)} · {formatDateTime(r.createdAt)}</p>
                {canUpdate && nextSteps.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 border-t border-line pt-2">
                    {nextSteps.map((next: RepairStatus) => (
                      <button
                        key={next}
                        type="button"
                        onClick={() => handleTransition(r, next)}
                        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-ink hover:bg-accent hover:text-white"
                      >
                        Move to {next} →
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
          columns={[
            { key: "serial", header: "Board Serial", render: (r) => <span className="font-mono font-medium">{r.boardSerial}</span> },
            { key: "id", header: "Job ID", render: (r) => `#${shortId(r.id)}` },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "created", header: "Logged", render: (r) => formatDateTime(r.createdAt) },
            ...(canUpdate
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    render: (r: RepairRecord) => {
                      const next = repairTransitions[r.status] || [];
                      if (next.length === 0) return <span className="text-xs text-muted">Final status</span>;
                      return (
                        <div className="flex gap-1">
                          {next.map((n: RepairStatus) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => handleTransition(r, n)}
                              className="rounded border border-line bg-surface px-2 py-0.5 text-xs font-medium hover:bg-slate-100"
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      );
                    },
                  },
                ]
              : []),
          ]}
          detail={(r) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Serial</dt><dd className="font-mono font-medium">{r.boardSerial}</dd>
              <dt className="text-muted">Status</dt><dd><StatusBadge status={r.status} /></dd>
              <dt className="text-muted">Job ID</dt><dd>#{shortId(r.id)}</dd>
              <dt className="text-muted">Received</dt><dd>{formatDateTime(r.createdAt)}</dd>
            </dl>
          )}
        />
      )}
    </>
  );
}

function RepairForm({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const form = useForm<CreateRepairPayload>({
    resolver: zodResolver(createRepairPayloadSchema),
    defaultValues: { boardSerial: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await opsApi.createRepair(siteId, values);
      notify.success("PCB registered for repair");
      onDone();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  });

  return (
    <Panel title="Log PCB for repair">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label="Board Serial Number"
          placeholder="e.g. PCB-2026-X884"
          error={errors.boardSerial?.message}
          {...form.register("boardSerial")}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Logging…" : "Submit repair"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
