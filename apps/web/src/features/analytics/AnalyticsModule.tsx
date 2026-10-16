import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState, LoadingState } from "../../components/feedback";
import { PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";

const STATUSES = ["submitted", "approved", "assigned", "fulfilled", "rejected"];

/** Charts are aggregated client-side from live API rows the user can already see. No invented data. */
export function AnalyticsModule({ page }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const canRequests = permissions.has("request:view");
  const canStock = permissions.has("inventory:view");
  const requests = useAsync(() => (canRequests ? opsApi.requests(siteId) : Promise.resolve(null)), [siteId, canRequests]);
  const items = useAsync(() => (canStock ? opsApi.items(siteId) : Promise.resolve(null)), [siteId, canStock]);

  const loading = requests.loading || items.loading;
  const error = requests.error ?? items.error;

  return (
    <>
      <PageHeader title={page.title} subtitle="Aggregated from current records in the database. Only data your role can access is included." />
      {loading && <LoadingState />}
      {error ? <ErrorState error={error} onRetry={() => (requests.reload(), items.reload())} /> : null}
      {!loading && !error && !requests.data && !items.data && (
        <EmptyState title="No analytics sources available" hint="Your role has no permission to view the records analytics are built from." />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {requests.data && (
          <Panel title="Requests by status">
            {requests.data.items.length === 0 ? (
              <EmptyState title="No requests recorded" />
            ) : (
              <Chart data={STATUSES.map((s) => ({ label: s, value: requests.data!.items.filter((r) => r.status === s).length }))} unit="requests" />
            )}
          </Panel>
        )}
        {items.data && (
          <Panel title="Stock on hand by item">
            {items.data.items.length === 0 ? <EmptyState title="No inventory items" /> : <Chart data={items.data.items.map((i) => ({ label: i.sku, value: i.onHand }))} unit="on hand" />}
          </Panel>
        )}
      </div>
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
