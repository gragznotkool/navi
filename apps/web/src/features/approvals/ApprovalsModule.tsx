import { useState } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { RequestRecord } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable, type BulkAction } from "../../components/tables/DataTable";
import { Button, PageHeader, StatusBadge } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useNow } from "../../hooks/useNow";
import { toRequestError } from "../../lib/api";
import { formatDateTime, shortId, totalQuantity } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

const SLA_PRESETS = [
  { label: "⚡ Demo (30s)", seconds: 30 },
  { label: "15 Minutes", seconds: 900 },
  { label: "1 Hour (Default)", seconds: 3600 },
  { label: "4 Hours", seconds: 14400 },
  { label: "24 Hours", seconds: 86400 },
];

export function ApprovalsModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const requests = useAsync(() => opsApi.requests(siteId), [siteId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [slaSeconds, setSlaSeconds] = useState(3600); // 1 hour standard SLA
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

  const handleBulkDecision = async (
    selected: RequestRecord[],
    decision: "approved" | "rejected",
    clearSelection: () => void,
  ) => {
    let successCount = 0;
    for (const req of selected) {
      try {
        await opsApi.decide(siteId, req.id, decision);
        successCount++;
      } catch (err) {
        notify.error(`Failed to ${decision} request #${shortId(req.id)}: ${toRequestError(err).message}`);
      }
    }
    notify.success(`Bulk operation complete: ${successCount} of ${selected.length} requests ${decision}`);
    clearSelection();
    requests.reload();
  };

  const pending = requests.data?.items.filter((r) => r.status === "submitted") ?? [];
  const now = useNow(1000);

  const bulkActions: BulkAction<RequestRecord>[] = canDecide
    ? [
        {
          label: "Approve Selected",
          icon: <CheckCircle2 className="h-4 w-4 mr-1 text-emerald-600" />,
          variant: "green",
          onClick: (selected, clear) => handleBulkDecision(selected, "approved", clear),
        },
        {
          label: "Reject Selected",
          icon: <XCircle className="h-4 w-4 mr-1 text-rose-600" />,
          variant: "danger",
          onClick: (selected, clear) => handleBulkDecision(selected, "rejected", clear),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="Submitted requests awaiting a decision with configurable SLA tracking."
        actions={
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 font-mono text-xs font-bold text-slate-600 dark:text-slate-300">
              <Clock className="h-3.5 w-3.5 text-[#FBBC04]" />
              SLA Threshold:
            </span>
            <select
              value={slaSeconds}
              onChange={(e) => setSlaSeconds(Number(e.target.value))}
              aria-label="SLA Threshold Preset"
              className="h-8 rounded-full border-2 border-[#1E293B] bg-white px-3 font-mono text-xs font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B] focus:border-[#FBBC04] focus:outline-none dark:border-[#334155] dark:bg-[#131B2E] dark:text-[#F8FAFC]"
            >
              {SLA_PRESETS.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {requests.loading && !requests.data && <LoadingState />}
      {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
      {requests.data && (
        <DataTable
          caption="Approval queue"
          rows={pending}
          rowKey={(r) => r.id}
          emptyTitle="The approval queue is empty"
          emptyHint="Newly submitted requests will appear here."
          selectable={canDecide}
          bulkActions={bulkActions}
          columns={[
            { key: "id", header: "Request", render: (r) => <span className="font-medium">#{shortId(r.id)}</span> },
            { key: "qty", header: "Qty", align: "right", render: (r) => totalQuantity(r) },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            {
              key: "sla",
              header: "SLA Status",
              render: (r) => {
                const elapsedSeconds = r.statusChangedAt
                  ? Math.floor((now - new Date(r.statusChangedAt).getTime()) / 1000)
                  : r.ageSeconds ?? 0;
                const remaining = slaSeconds - elapsedSeconds;
                const breached = remaining <= 0;

                const formatRemaining = (sec: number) => {
                  const s = Math.abs(sec);
                  if (s < 60) return `${s}s`;
                  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
                  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
                };

                return (
                  <div className="flex items-center gap-2 font-mono text-xs">
                    {breached ? (
                      <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#FF5C5C]/50 bg-[#FF5C5C]/15 px-2 py-0.5 text-[10px] font-bold text-[#FF5C5C] animate-pulse">
                        ⚠️ SLA BREACHED (+{formatRemaining(remaining)})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-[2px] border border-[#34A853]/40 bg-[#34A853]/10 px-2 py-0.5 text-[10px] font-semibold text-[#34A853] dark:text-[#4ADE80]">
                        ⏱️ {formatRemaining(remaining)} REMAINING
                      </span>
                    )}
                  </div>
                );
              },
            },
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
