import { Download } from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

export function ReportsModule({ page }: ModuleProps) {
  const { siteId, slug } = useSiteRuntime();
  const summary = useAsync(() => opsApi.stockSummary(siteId), [siteId]);
  const inventory = useAsync(() => opsApi.items(siteId), [siteId]);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const data = await opsApi.downloadExcel(siteId);
      const blob = new Blob([data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-${slug}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      notify.success("Excel inventory report downloaded");
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="Operational reports, server-side data aggregation, and verified Excel workbook generation."
        actions={
          <Button variant="primary" onClick={handleDownload} disabled={downloading}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden />
            {downloading ? "Generating…" : "Export Excel (.xlsx)"}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel title="Stock items">
          {summary.loading && <LoadingState />}
          {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : null}
          {summary.data && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                {summary.data.totalItems}
              </span>
              <span className="text-xs text-muted">lines in catalog</span>
            </div>
          )}
        </Panel>
        <Panel title="Reorder status">
          {summary.loading && <LoadingState />}
          {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : null}
          {summary.data && (
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold tracking-tight tabular-nums ${summary.data.belowReorderLevel > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {summary.data.belowReorderLevel}
              </span>
              <span className="text-xs text-muted">below minimum reorder point</span>
            </div>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Catalog Summary Preview</h2>
        </div>
        {inventory.loading && <LoadingState />}
        {inventory.error ? <ErrorState error={inventory.error} onRetry={inventory.reload} /> : null}
        {inventory.data && (
          <DataTable
            caption="Inventory preview"
            rows={inventory.data.items}
            rowKey={(r) => r.id}
            columns={[
              { key: "sku", header: "SKU", render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
              { key: "name", header: "Item name", render: (r) => <span className="font-medium">{r.name}</span> },
              { key: "onHand", header: "On hand", align: "right", render: (r) => r.onHand },
              { key: "reorder", header: "Reorder level", align: "right", render: (r) => r.reorderLevel },
              {
                key: "status",
                header: "Status",
                render: (r) => (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.onHand <= r.reorderLevel ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {r.onHand <= r.reorderLevel ? "Reorder" : "Adequate"}
                  </span>
                ),
              },
            ]}
          />
        )}
      </div>
    </>
  );
}
