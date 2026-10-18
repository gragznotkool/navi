import { useState } from "react";
import { QrCode, ScanLine } from "lucide-react";
import type { StockItem } from "@opshub/contracts";
import { FieldInput, visibleFields } from "../../components/FieldInputs";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, PageHeader, Panel } from "../../components/ui";
import { BarcodeScannerModal } from "../../components/barcode/BarcodeScannerModal";
import { QrCodeGeneratorModal } from "../../components/barcode/QrCodeGeneratorModal";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime } from "../../lib/format";
import { toRequestError } from "../../lib/api";
import { notify } from "../../stores/toast";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { ReportActions } from "../reports/ReportActions";

const levelBadge = (i: StockItem, threshold: number) =>
  i.onHand === 0 ? <Badge tone="danger">Out of stock</Badge> : i.onHand <= Math.max(i.reorderLevel, threshold) ? <Badge tone="warning">Low</Badge> : <Badge tone="success">OK</Badge>;

export function InventoryModule({ node, page }: ModuleProps) {
  const { siteId, config } = useSiteRuntime();
  const fields = visibleFields(config.fields, "inventory_item");
  const threshold = typeof node.config.lowStockThreshold === "number" ? node.config.lowStockThreshold : 0;
  const items = useAsync(() => opsApi.items(siteId), [siteId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [qrItem, setQrItem] = useState<StockItem | null>(null);

  const handleScanFound = (sku: string) => {
    if (!items.data) return;
    const match = items.data.items.find((i) => i.sku.toLowerCase() === sku.toLowerCase());
    if (match) {
      setSelected(match.id);
      notify.success(`Selected matched inventory item: ${match.name}`);
    } else {
      notify.error(`SKU "${sku}" not found in current site stock ledger`);
    }
  };

  const columns: Column<StockItem>[] = [
    { key: "sku", header: "SKU", render: (i) => <span className="font-medium">{i.sku}</span> },
    { key: "name", header: "Item", render: (i) => i.name },
    { key: "onHand", header: "On hand", align: "right", render: (i) => `${i.onHand} ${i.unit}` },
    { key: "reorder", header: "Reorder level", align: "right", render: (i) => i.reorderLevel },
    { key: "level", header: "Stock level", render: (i) => levelBadge(i, threshold) },
    ...fields.map((f): Column<StockItem> => ({ key: `field-${f.id}`, header: f.label, render: (i) => (i.extras[f.key] === undefined ? "—" : String(i.extras[f.key])) })),
    { key: "updated", header: "Updated", render: (i) => formatDateTime(i.updatedAt) },
    {
      key: "qr",
      header: "Tag",
      render: (i) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setQrItem(i);
          }}
          title="Generate QR / Barcode Tag"
          className="rounded-lg border-2 border-[#1E293B] bg-slate-50 p-1 text-[#0F172A] shadow-[1px_1px_0px_#1E293B] hover:bg-[#FBBC04] transition dark:border-[#334155] dark:bg-slate-800 dark:text-white"
        >
          <QrCode className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="Stock levels from the site database. Select an item to see its ledger."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setIsScannerOpen(true)} className="gap-1.5">
              <ScanLine className="h-4 w-4 text-[#FBBC04]" /> Scan Barcode
            </Button>
            <ReportActions reportKey="inventory" />
          </div>
        }
      />
      {items.loading && <LoadingState />}
      {items.error ? <ErrorState error={items.error} onRetry={items.reload} /> : null}
      {items.data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <DataTable
            caption="Inventory items"
            rows={items.data.items}
            rowKey={(i) => i.id}
            columns={columns}
            onRowClick={(i) => setSelected(i.id)}
            selectedKey={selected}
            emptyTitle="No inventory items"
            emptyHint="Items appear here once stock is created for this site."
          />
          {selected && (
            <ItemDetail
              siteId={siteId}
              itemId={selected}
              onSaved={items.reload}
              onGenerateQr={(item) => setQrItem(item)}
            />
          )}
        </div>
      )}

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleScanFound}
      />

      {/* QR Code Tag Modal */}
      {qrItem && (
        <QrCodeGeneratorModal
          isOpen={Boolean(qrItem)}
          onClose={() => setQrItem(null)}
          sku={qrItem.sku}
          name={qrItem.name}
          location={`BIN-${qrItem.sku.slice(0, 3)}-01`}
        />
      )}
    </>
  );
}

function ItemDetail({
  siteId,
  itemId,
  onSaved,
  onGenerateQr,
}: {
  siteId: string;
  itemId: string;
  onSaved: () => void;
  onGenerateQr?: (item: StockItem) => void;
}) {
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
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{detail.data.item.name}</p>
              <p className="text-xs text-muted">
                {detail.data.item.sku} · {detail.data.item.onHand} {detail.data.item.unit} on hand
              </p>
            </div>
            {onGenerateQr && (
              <Button
                variant="secondary"
                onClick={() => onGenerateQr(detail.data!.item)}
                className="gap-1.5 h-8 text-xs font-mono"
              >
                <QrCode className="h-3.5 w-3.5 text-[#FBBC04]" /> Label
              </Button>
            )}
          </div>
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
