import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { ImportReport } from "@opshub/contracts";
import { Badge, Button, Panel } from "../../components/ui";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import { excelApi } from "../../services";
import { notify } from "../../stores/toast";

const MAX_BYTES = 1_000_000;

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const newKey = (): string => `import-${crypto.randomUUID()}`;

/**
 * Excel export, and a two-step import: choose a file, read the dry-run report, then apply.
 * Nothing is written until the user presses Apply, and an import with any problem writes nothing at all.
 */
export function ExcelPanel({ onImported }: { onImported: () => void }) {
  const { siteId, slug, permissions } = useSiteRuntime();
  const canExport = permissions.has("inventory:view");
  const canImport = permissions.has("inventory:manage");
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"export" | "check" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per chosen file: pressing Apply twice (or retrying after a network error) can never import twice.
  const [key, setKey] = useState(newKey);

  const download = async (kind: "reports/inventory" | "imports/inventory/template", name: string) => {
    setBusy("export");
    setError(null);
    try {
      saveBlob(await excelApi.download(siteId, kind), `${slug}-${name}.xlsx`);
    } catch (e) {
      setError(toRequestError(e).message || "The download failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const choose = async (f: File | null) => {
    setReport(null);
    setError(null);
    setFile(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".xlsx")) return setError("Choose an Excel file ending in .xlsx.");
    if (f.size > MAX_BYTES) return setError("That file is larger than 1 MB. Split it into smaller files.");
    setFile(f);
    setKey(newKey());
    setBusy("check");
    try {
      setReport(await excelApi.importInventory(siteId, f, { apply: false }));
    } catch (e) {
      setError(toRequestError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!file) return;
    setBusy("apply");
    setError(null);
    try {
      const r = await excelApi.importInventory(siteId, file, { apply: true, key });
      setReport(r);
      if (r.applied) {
        notify.success(r.replayed ? "That import had already been applied." : `Imported: ${r.totals.create} new, ${r.totals.update} updated.`);
        onImported();
        setFile(null);
        if (input.current) input.current.value = "";
      } else {
        setError("Nothing was imported. Fix the problems below and choose the file again.");
      }
    } catch (e) {
      setError(toRequestError(e).message);
    } finally {
      setBusy(null);
    }
  };

  if (!canExport && !canImport) return null;
  const blocking = report !== null && (report.fileErrors.length > 0 || report.totals.errors > 0);
  const nothingToDo = report !== null && report.totals.create + report.totals.update === 0;
  const problems = report?.rows.filter((r) => r.errors.length > 0) ?? [];
  const changes = report?.rows.filter((r) => r.action === "create" || r.action === "update") ?? [];

  return (
    <Panel title="Excel" actions={<FileSpreadsheet className="h-4 w-4 text-muted" aria-hidden />}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {canExport && <Button onClick={() => void download("reports/inventory", "inventory")} loading={busy === "export"}><Download className="h-3.5 w-3.5" aria-hidden /> Export inventory</Button>}
          {canImport && <Button onClick={() => void download("imports/inventory/template", "inventory-template")} disabled={busy !== null}>Download import template</Button>}
        </div>
        {canImport && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <label htmlFor="excel-file" className="font-medium">Import from Excel</label>
            <input id="excel-file" ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void choose(e.target.files?.[0] ?? null)} className="text-xs" />
            <p className="text-xs text-muted">Columns: SKU, Name, Unit, On hand, Reorder level and your item fields. You will see a preview first; formulas are not accepted.</p>
          </div>
        )}
        {busy === "check" && <p role="status" className="text-xs text-muted">Checking the file…</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {report && (
          <div className="flex flex-col gap-2 rounded-ui border border-line p-3" aria-label="Import preview">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={blocking ? "danger" : report.applied ? "success" : "info"}>{report.applied ? "Imported" : blocking ? "Cannot import" : "Preview: nothing changed yet"}</Badge>
              <span className="text-xs text-muted">{report.totals.rows} rows · {report.totals.create} new · {report.totals.update} updated · {report.totals.unchanged} unchanged · {report.totals.errors} with problems · {report.totals.stockChanges} stock change(s)</span>
            </div>
            {report.fileErrors.length > 0 && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-xs text-red-700" aria-label="Problems with the file">
                {report.fileErrors.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
            {problems.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-red-700" aria-label="Rows with problems">
                {problems.map((r) => <li key={r.row}>Row {r.row}{r.sku ? ` (${r.sku})` : ""}: {r.errors.join(" ")}</li>)}
              </ul>
            )}
            {changes.length > 0 && (
              <ul className="max-h-60 list-disc space-y-1 overflow-auto pl-5 text-xs" aria-label="What would change">
                {changes.map((r) => <li key={r.row}><strong>{r.sku}</strong>: {r.changes.join("; ")}</li>)}
              </ul>
            )}
            {!report.applied && !blocking && nothingToDo && <p className="text-xs text-muted">Nothing in this file would change anything.</p>}
            {!report.applied && (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void apply()} loading={busy === "apply"} disabled={blocking || nothingToDo || busy !== null}><Upload className="h-3.5 w-3.5" aria-hidden /> Apply import</Button>
                <Button onClick={() => { setReport(null); setFile(null); setError(null); if (input.current) input.current.value = ""; }}>Cancel</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
