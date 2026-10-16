import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  createReturnPayloadSchema,
  returnTransitions,
  type CreateReturnPayload,
  type ReturnRecord,
  type ReturnStatus,
} from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { RecordView } from "../../components/tables/RecordView";
import { Button, PageHeader, Panel, SelectField, StatusBadge, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime, shortId } from "../../lib/format";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

const RETURN_STATUSES: ReturnStatus[] = ["initiated", "inspected", "restocked", "rejected"];

export function ReturnsModule({ page, layout }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const returns = useAsync(() => opsApi.returns(siteId), [siteId]);
  const [initiating, setInitiating] = useState(false);
  const canProcess = permissions.has("return:process");

  const handleTransition = async (ret: ReturnRecord, toStatus: ReturnStatus) => {
    try {
      await opsApi.updateReturnStatus(siteId, ret.id, toStatus);
      notify.success(
        toStatus === "restocked"
          ? `Return #${shortId(ret.id)} restocked to inventory (+${ret.quantity})`
          : `Return #${shortId(ret.id)} moved to ${toStatus}`,
      );
      returns.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  };

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="Manage returned equipment, physical inspection triage, and stock restocking."
        actions={
          <Button variant="primary" onClick={() => setInitiating((v) => !v)} aria-expanded={initiating}>
            Initiate return
          </Button>
        }
      />
      {initiating && (
        <div className="mb-4">
          <ReturnForm
            siteId={siteId}
            onDone={() => {
              setInitiating(false);
              returns.reload();
            }}
          />
        </div>
      )}
      {returns.loading && !returns.data && <LoadingState />}
      {returns.error ? <ErrorState error={returns.error} onRetry={returns.reload} /> : null}
      {returns.data && (
        <RecordView<ReturnRecord>
          layout={layout}
          caption="Return Records"
          rows={returns.data.items}
          rowKey={(r) => r.id}
          groupBy={(r) => r.status}
          groups={RETURN_STATUSES}
          onMove={canProcess ? (r, to) => handleTransition(r, to as ReturnStatus) : undefined}
          emptyTitle="No return records"
          emptyHint="Initiate a return against an active material assignment."
          card={(r) => {
            const next = returnTransitions[r.status] || [];
            return (
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm">#{shortId(r.id)}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-muted">
                  Assignment #{shortId(r.assignmentId)} · Qty: {r.quantity}
                </p>
                <p className="text-xs text-muted">{formatDateTime(r.createdAt)}</p>
                {canProcess && next.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 border-t border-line pt-2">
                    {next.map((n: ReturnStatus) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleTransition(r, n)}
                        className={`rounded px-2 py-1 text-xs font-medium text-white ${
                          n === "restocked" ? "bg-emerald-600 hover:bg-emerald-700" : n === "rejected" ? "bg-rose-600 hover:bg-rose-700" : "bg-accent hover:opacity-90"
                        }`}
                      >
                        {n === "restocked" ? "✓ Restock" : n === "rejected" ? "✕ Reject" : `Mark ${n}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }}
          columns={[
            { key: "id", header: "Return ID", render: (r) => <span className="font-medium">#{shortId(r.id)}</span> },
            { key: "assignment", header: "Assignment", render: (r) => (r.assignmentId ? `#${shortId(r.assignmentId)}` : "Direct Return") },
            { key: "qty", header: "Quantity", align: "right", render: (r) => `${r.quantity} items` },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "created", header: "Initiated", render: (r) => formatDateTime(r.createdAt) },
            ...(canProcess
              ? [
                  {
                    key: "actions",
                    header: "Triage Actions",
                    render: (r: ReturnRecord) => {
                      const next = returnTransitions[r.status] || [];
                      if (next.length === 0) return <span className="text-xs text-muted">Archived</span>;
                      return (
                        <div className="flex gap-1">
                          {next.map((n: ReturnStatus) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => handleTransition(r, n)}
                              className={`rounded border px-2 py-0.5 text-xs font-medium ${
                                n === "restocked"
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                  : n === "rejected"
                                    ? "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
                                    : "border-line bg-surface hover:bg-slate-100"
                              }`}
                            >
                              {n === "restocked" ? "Restock item" : n === "rejected" ? "Reject" : n}
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
              <dt className="text-muted">Return ID</dt><dd>#{shortId(r.id)}</dd>
              <dt className="text-muted">Status</dt><dd><StatusBadge status={r.status} /></dd>
              <dt className="text-muted">Assignment</dt><dd>#{shortId(r.assignmentId)}</dd>
              <dt className="text-muted">Quantity</dt><dd>{r.quantity}</dd>
              <dt className="text-muted">Initiated</dt><dd>{formatDateTime(r.createdAt)}</dd>
            </dl>
          )}
        />
      )}
    </>
  );
}

function ReturnForm({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const assignments = useAsync(() => opsApi.assignments(siteId), [siteId]);
  const form = useForm<CreateReturnPayload>({
    resolver: zodResolver(createReturnPayloadSchema),
    defaultValues: { quantity: 1 },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await opsApi.createReturn(siteId, values);
      notify.success("Return initiated");
      onDone();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  });

  return (
    <Panel title="Initiate material return">
      {assignments.loading && <LoadingState />}
      {assignments.error ? <ErrorState error={assignments.error} onRetry={assignments.reload} /> : null}
      {assignments.data && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <SelectField
            label="Assigned Material"
            error={errors.assignmentId?.message}
            {...form.register("assignmentId")}
          >
            <option value="">Select an assignment to return…</option>
            {assignments.data.map((a) => (
              <option key={a.id} value={a.id}>
                #{shortId(a.id)} (qty: {a.quantity})
              </option>
            ))}
          </SelectField>
          <TextField
            label="Quantity to return"
            type="number"
            min={1}
            error={errors.quantity?.message}
            {...form.register("quantity", { valueAsNumber: true })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Initiating…" : "Submit return"}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
