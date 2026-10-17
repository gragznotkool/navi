import { Badge, PageHeader, Panel } from "../../components/ui";
import { ErrorState, LoadingState } from "../../components/feedback";
import { useAsync } from "../../hooks/useAsync";
import { opsApi, sitesApi } from "../../services";
import { useSiteRuntime } from "../context";
import type { ModuleProps } from "../registry";

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-2xl border-2 border-[#1E293B] bg-white p-5 shadow-[4px_4px_0px_#1E293B] transition-transform hover:-translate-y-0.5">
      <p className="font-['Outfit',sans-serif] text-xs font-bold uppercase tracking-wider text-[#64748B]">{label}</p>
      <p className="mt-1 font-['Outfit',sans-serif] text-3xl font-black tabular-nums text-[#0F172A]">{value}</p>
      {note && <p className="mt-1 text-xs font-medium text-[#64748B]">{note}</p>}
    </div>
  );
}

const statusTone = { implemented: "success", partial: "warning", "contract-only": "neutral" } as const;

export function DashboardModule({ page }: ModuleProps) {
  const { siteId, config, permissions, version } = useSiteRuntime();
  const canStock = permissions.has("inventory:view");
  const canRequests = permissions.has("request:view");
  const items = useAsync(() => (canStock ? opsApi.items(siteId) : Promise.resolve(null)), [siteId, canStock]);
  const requests = useAsync(() => (canRequests ? opsApi.requests(siteId) : Promise.resolve(null)), [siteId, canRequests]);
  const modules = useAsync(() => sitesApi.modules(), []);

  const below = items.data?.items.filter((i) => i.onHand <= i.reorderLevel).length ?? 0;
  const open = requests.data?.items.filter((r) => r.status === "submitted").length ?? 0;

  return (
    <>
      <PageHeader title={page.title} subtitle={`${config.name} · configuration version ${version ?? "draft"}`} />
      {(items.loading || requests.loading) && <LoadingState />}
      {items.error ? <ErrorState error={items.error} onRetry={items.reload} /> : null}
      {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.data && <Stat label="Inventory items" value={items.data.total} note="From the stock database" />}
        {items.data && <Stat label="At or below reorder level" value={below} />}
        {requests.data && <Stat label="Requests awaiting approval" value={open} />}
        {requests.data && <Stat label="Total requests" value={requests.data.total} />}
      </div>
      <Panel title="Enabled modules">
        {modules.loading && <LoadingState />}
        {modules.error ? <ErrorState error={modules.error} onRetry={modules.reload} /> : null}
        {modules.data && (
          <ul className="divide-y-2 divide-slate-100">
            {config.modules.nodes.map((n) => {
              const def = modules.data!.find((m) => m.type === n.moduleType);
              return (
                <li key={n.id} className="flex items-center justify-between py-3">
                  <span className="font-['Outfit',sans-serif] text-sm font-bold text-[#0F172A]">{def?.displayName ?? n.moduleType}</span>
                  {def && <Badge tone={statusTone[def.implementationStatus]}>{def.implementationStatus}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
