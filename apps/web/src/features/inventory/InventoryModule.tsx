import { useState } from "react";
import type { StockItem } from "@opshub/contracts";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { ReportActions } from "../reports/ReportActions";

const levelBadge = (i: StockItem, threshold: number) =>
  i.onHand === 0 ? <Badge tone="danger">Out of stock</Badge> : i.onHand <= Math.max(i.reorderLevel, threshold) ? <Badge tone="warning">Low</Badge> : <Badge tone="success">OK</Badge>;

export function InventoryModule({ node, page }: ModuleProps) {
  const { siteId } = useSiteRuntime();
  const threshold = typeof node.config.lowStockThreshold === "number" ? node.config.lowStockThreshold : 0;
  const items = useAsync(() => opsApi.items(siteId), [siteId]);
  const [selected, setSelected] = useState<string | null>(null);

  const columns: Column<StockItem>[] = [
    { key: "sku", header: "SKU", render: (i) => <span className="font-medium">{i.sku}</span> },
    { key: "name", header: "Item", render: (i) => i.name },
    { key: "onHand", header: "On hand", align: "right", render: (i) => `${i.onHand} ${i.unit}` },
    { key: "reorder", header: "Reorder level", align: "right", render: (i) => i.reorderLevel },
    { key: "level", header: "Stock level", render: (i) => levelBadge(i, threshold) },
    { key: "updated", header: "Updated", render: (i) => formatDateTime(i.updatedAt) },
  ];

  return (
    <>
      <PageHeader title={page.title} subtitle="Stock levels from the site database. Select an item to see its ledger." actions={<ReportActions reportKey="inventory" />} />
      {items.loading && <LoadingState />}
      {items.error ? <ErrorState error={items.error} onRetry={items.reload} /> : null}
      {items.data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DataTable caption="Inventory items" rows={items.data.items} rowKey={(i) => i.id} columns={columns} onRowClick={(i) => setSelected(i.id)} selectedKey={selected} emptyTitle="No inventory items" emptyHint="Items appear here once stock is created for this site." />
          {selected && <ItemDetail siteId={siteId} itemId={selected} />}
        </div>
      )}
    </>
  );
}

function ItemDetail({ siteId, itemId }: { siteId: string; itemId: string }) {
  const detail = useAsync(() => opsApi.item(siteId, itemId), [siteId, itemId]);
  return (
    <Panel title="Item detail">
      {detail.loading && <LoadingState />}
      {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} /> : null}
      {detail.data && (
        <>
          <p className="text-sm font-semibold">{detail.data.item.name}</p>
          <p className="text-xs text-muted">
            {detail.data.item.sku} · {detail.data.item.onHand} {detail.data.item.unit} on hand
          </p>
          <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Stock ledger (latest 50)</h3>
          <DataTable
            caption="Stock ledger"
            rows={detail.data.ledger}
            rowKey={(l) => l.id}
            emptyTitle="No ledger entries"
            columns={[
              { key: "when", header: "When", render: (l) => formatDateTime(l.createdAt) },
              { key: "reason", header: "Reason", render: (l) => l.reason },
              { key: "delta", header: "Change", align: "right", render: (l) => (l.delta > 0 ? `+${l.delta}` : l.delta) },
              { key: "bal", header: "Balance", align: "right", render: (l) => l.balanceAfter },
            ]}
          />
        </>
      )}
    </Panel>
  );
}
