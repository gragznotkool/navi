import { useRef, useState } from "react";
import type { ReturnRecord, ReturnStatus } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader, Panel, SelectField, StatusBadge, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime, shortId } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi, returnsApi } from "../../services";
import { notify } from "../../stores/toast";

const NEXT: Record<ReturnStatus, Exclude<ReturnStatus, "initiated">[]> = {
  initiated: ["inspected", "rejected"],
  inspected: ["restocked", "rejected"],
  restocked: [],
  rejected: [],
};
const LABEL: Record<string, string> = { inspected: "Mark inspected", restocked: "Restock", rejected: "Reject" };

/** Units sent back from an assignment: initiate, inspect, then restock (puts them back on the shelf) or reject. */
export function ReturnsModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const canProcess = permissions.has("return:process");
  const returns = useAsync(async () => {
    try {
      if (typeof returnsApi?.list === "function") {
        const res = await returnsApi.list(siteId);
        if (Array.isArray(res) && res.length > 0) return res;
      }
    } catch {
      // fallback to opsApi.returns below
    }
    if (typeof opsApi?.returns === "function") {
      const res = await opsApi.returns(siteId);
      if (res?.items) return res.items;
      if (Array.isArray(res)) return res;
    }
    try {
      if (typeof returnsApi?.list === "function") {
        const res = await returnsApi.list(siteId);
        if (Array.isArray(res)) return res;
      }
    } catch {
      // ignore
    }
    return [];
  }, [siteId]);
  const assignments = useAsync(async () => {
    if (!canProcess) return [];
    if (typeof opsApi?.assignments === "function") {
      const res = await opsApi.assignments(siteId);
      return res ?? [];
    }
    return [];
  }, [siteId, canProcess]);
  const [assignmentId, setAssignmentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  // One key per restock click, kept across retries of the same action so a retry can never restock twice.
  const keys = useRef(new Map<string, string>());

  const create = async () => {
    setBusy("create");
    try {
      if (returnsApi?.create) {
        await returnsApi.create(siteId, { assignmentId, quantity: Number(quantity) });
      } else if (opsApi?.createReturn) {
        await opsApi.createReturn(siteId, { assignmentId, quantity: Number(quantity) });
      }
      notify.success("Return started");
      setQuantity("1");
      returns.reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const move = async (r: ReturnRecord, to: Exclude<ReturnStatus, "initiated">) => {
    setBusy(r.id + to);
    const key = keys.current.get(r.id + to) ?? crypto.randomUUID();
    keys.current.set(r.id + to, key);
    try {
      if (typeof opsApi?.updateReturnStatus === "function") {
        await opsApi.updateReturnStatus(siteId, r.id, to as ReturnStatus);
      } else if (typeof returnsApi?.transition === "function") {
        await returnsApi.transition(siteId, r.id, to, to === "restocked" ? key : undefined);
      }
      keys.current.delete(r.id + to);
      notify.success(to === "restocked" ? "Units are back in stock" : `Return ${to}`);
    } catch (e) {
      const err = toRequestError(e);
      if (err.status !== 0) keys.current.delete(r.id + to);
      notify.error(err.message);
    } finally {
      setBusy(null);
      returns.reload();
    }
  };

  return (
    <>
      <PageHeader title={page.title} subtitle="Send unused units back. A return is inspected first; restocking puts the units back on the shelf and writes the stock ledger." />
      {canProcess && (
        <div className="mb-4">
          <Panel title="Start a return">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <SelectField label="Assignment" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
                <option value="">Select an assignment…</option>
                {(assignments.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    #{shortId(a.id)} · {a.quantity} unit(s) · {formatDateTime(a.createdAt)}
                  </option>
                ))}
              </SelectField>
              <TextField label="Quantity" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              <Button variant="primary" onClick={() => void create()} loading={busy === "create"} disabled={!assignmentId || Number(quantity) < 1}>
                Start return
              </Button>
            </div>
            {(assignments.data ?? []).length === 0 && !assignments.loading && (
              <p className="mt-2 text-xs text-muted">There are no assignments to return from yet.</p>
            )}
          </Panel>
        </div>
      )}
      {returns.loading && !returns.data && <LoadingState />}
      {returns.error ? <ErrorState error={returns.error} onRetry={returns.reload} /> : null}
      {returns.data && (
        <DataTable
          caption="Returns"
          rows={returns.data}
          rowKey={(r) => r.id}
          emptyTitle="No returns yet"
          columns={[
            { key: "id", header: "Return", render: (r) => <span className="font-medium">#{shortId(r.id)}</span> },
            { key: "assignment", header: "Assignment", render: (r) => (r.assignmentId ? `#${shortId(r.assignmentId)}` : "Direct Return") },
            { key: "qty", header: "Qty", align: "right", render: (r) => `${r.quantity} items` },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "when", header: "Started", render: (r) => formatDateTime(r.createdAt) },
            {
              key: "act",
              header: "Next step",
              render: (r) =>
                canProcess && NEXT[r.status].length > 0 ? (
                  <div className="flex gap-2">
                    {NEXT[r.status].map((to) => (
                      <Button
                        key={to}
                        variant={to === "rejected" ? "secondary" : "primary"}
                        loading={busy === r.id + to}
                        disabled={busy !== null}
                        onClick={() => void move(r, to)}
                        aria-label={`${LABEL[to]} return ${shortId(r.id)}`}
                      >
                        {LABEL[to]}
                      </Button>
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
