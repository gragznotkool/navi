import { useState } from "react";
import type { StockItem } from "@opshub/contracts";
import { FieldInput, visibleFields } from "../../components/FieldInputs";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime } from "../../lib/format";
import { toRequestError } from "../../lib/api";
import { notify } from "../../stores/toast";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { ExcelPanel } from "./ExcelPanel";

const levelBadge = (i: StockItem, threshold: number) =>
  i.onHand === 0 ? <Badge tone="danger">Out of stock</Badge> : i.onHand <= Math.max(i.reorderLevel, threshold) ? <Badge tone="warning">Low</Badge> : <Badge tone="success">OK</Badge>;

export function InventoryModule({ node, page }: ModuleProps) {
  const { siteId, config } = useSiteRuntime();
  const fields = visibleFields(config.fields, "inventory_item");
  const threshold = typeof node.config.lowStockThreshold === "number" ? node.config.lowStockThreshold : 0;
  const items = useAsync(() => opsApi.items(siteId), [siteId]);
  const [selected, setSelected] = useState<string | null>(null);

  const columns: Column<StockItem>[] = [
    { key: "sku", header: "SKU", render: (i) => <span className="font-medium">{i.sku}</span> },
    { key: "name", header: "Item", render: (i) => i.name },
    { key: "onHand", header: "On hand", align: "right", render: (i) => `${i.onHand} ${i.unit}` },
    { key: "reorder", header: "Reorder level", align: "right", render: (i) => i.reorderLevel },
    { key: "level", header: "Stock level", render: (i) => levelBadge(i, threshold) },
    ...fields.map((f): Column<StockItem> => ({ key: `field-${f.id}`, header: f.label, render: (i) => (i.extras[f.key] === undefined ? "—" : String(i.extras[f.key])) })),
    { key: "updated", header: "Updated", render: (i) => formatDateTime(i.updatedAt) },
  ];

  return (
    <>
      <PageHeader title={page.title} subtitle="Stock levels from the site database. Select an item to see its ledger." />
      <div className="mb-4"><ExcelPanel onImported={items.reload} /></div>
      {items.loading && <LoadingState />}
      {items.error ? <ErrorState error={items.error} onRetry={items.reload} /> : null}
      {items.data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DataTable caption="Inventory items" rows={items.data.items} rowKey={(i) => i.id} columns={columns} onRowClick={(i) => setSelected(i.id)} selectedKey={selected} emptyTitle="No inventory items" emptyHint="Items appear here once stock is created for this site." />
          {selected && <ItemDetail siteId={siteId} itemId={selected} onSaved={items.reload} />}
        </div>
      )}
    </>
  );
}

function ItemDetail({ siteId, itemId, onSaved }: { siteId: string; itemId: string; onSaved: () => void }) {
  const { config, permissions } = useSiteRuntime();
  const detail = useAsync(() => opsApi.item(siteId, itemId), [siteId, itemId]);
  const fields = visibleFields(config.fields, "inventory_item");
  const canEdit = permissions.has("inventory:manage");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      // `null` clears a value the user emptied.
      await opsApi.updateItemFields(siteId, itemId, { extras: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v === undefined ? null : v])) });
      notify.success("Item fields saved");
      setDraft({});
      detail.reload();
      onSaved();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setSaving(false);
    }
  };
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
          {fields.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Fields</h3>
              {fields.map((f) => (
                <FieldInput
                  key={`${itemId}-${f.id}`}
                  field={f}
                  disabled={!canEdit}
                  value={f.key in draft ? draft[f.key] : detail.data!.item.extras[f.key]}
                  onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                />
              ))}
              {canEdit && <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>Save fields</Button>}
            </div>
          )}
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
