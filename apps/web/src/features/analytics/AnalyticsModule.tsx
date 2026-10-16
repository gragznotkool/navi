import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState, LoadingState } from "../../components/feedback";
import { PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { analyticsApi } from "../../services";

const REQUEST_STATUSES = ["submitted", "approved", "assigned", "fulfilled", "rejected"];
const RETURN_STATUSES = ["initiated", "inspected", "restocked", "rejected"];
const REPAIR_STATUSES = ["received", "diagnosing", "repairing", "testing", "completed", "scrapped"];

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-ui border border-line bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

/** Numbers are aggregated by the server from this site's own records, and only for kinds of record the user may see. */
export function AnalyticsModule({ page }: ModuleProps) {
  const { siteId } = useSiteRuntime();
  const summary = useAsync(() => analyticsApi.summary(siteId), [siteId]);
  const d = summary.data;
  const empty = d && !d.stock && !d.requests && !d.returns && !d.repairs;

  return (
    <>
      <PageHeader title={page.title} subtitle="Aggregated by the server from current records. Only data your role can access is included." />
      {summary.loading && !d && <LoadingState />}
      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : null}
      {empty && <EmptyState title="No analytics sources available" hint="Your role has no permission to view the records analytics are built from." />}
      {d && (
        <div className="flex flex-col gap-4">
          {(d.stock || d.requests?.overdue != null) && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {d.stock && <Stat label="Inventory items" value={d.stock.totalItems} note={`${d.stock.totalOnHand} units on hand`} />}
              {d.stock && <Stat label="At or below reorder level" value={d.stock.belowReorderLevel} />}
              {d.stock && <Stat label="Out of stock" value={d.stock.outOfStock} />}
              {d.requests?.overdue != null && <Stat label="Overdue approvals" value={d.requests.overdue} note="Past the site's approval deadline" />}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {d.requests && (
              <Panel title="Requests by status">
                {Object.keys(d.requests.byStatus).length === 0 ? <EmptyState title="No requests recorded" /> : <Chart data={REQUEST_STATUSES.map((s) => ({ label: s, value: d.requests!.byStatus[s] ?? 0 }))} unit="requests" />}
              </Panel>
            )}
            {d.movements && (
              <Panel title="Stock movements, last 14 days">
                {d.movements.every((m) => m.unitsIn === 0 && m.unitsOut === 0) ? (
                  <EmptyState title="No stock movements in the last 14 days" />
                ) : (
                  <div role="img" aria-label={d.movements.map((m) => `${m.day}: ${m.unitsIn} in, ${m.unitsOut} out`).join("; ")} className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={d.movements.map((m) => ({ label: m.day.slice(5), In: m.unitsIn, Out: m.unitsOut }))} margin={{ left: -16 }}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="In" fill="#16a34a" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Out" fill="#dc2626" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
            )}
            {d.returns && (
              <Panel title="Returns by status">
                {Object.keys(d.returns.byStatus).length === 0 ? <EmptyState title="No returns recorded" /> : <Chart data={RETURN_STATUSES.map((s) => ({ label: s, value: d.returns!.byStatus[s] ?? 0 }))} unit="returns" />}
              </Panel>
            )}
            {d.repairs && (
              <Panel title="Repairs by status">
                {Object.keys(d.repairs.byStatus).length === 0 ? <EmptyState title="No boards received" /> : <Chart data={REPAIR_STATUSES.map((s) => ({ label: s, value: d.repairs!.byStatus[s] ?? 0 }))} unit="boards" />}
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Chart({ data, unit }: { data: { label: string; value: number }[]; unit: string }) {
  return (
    <div role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")} className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -16 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => [String(v), unit]} />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
