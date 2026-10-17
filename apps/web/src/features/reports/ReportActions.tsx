import { CheckCircle2, Download, FileSpreadsheet, Lock, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import type { ImportResult, ImportRowError, ReportAccess } from "@opshub/contracts";
import { REPORT_MAX_BYTES, REPORT_MAX_ROWS } from "@opshub/contracts";
import { Badge, Button } from "../../components/ui";
import { saveBlob, toRequestError, type ApiRequestError } from "../../lib/api";
import { useAsync } from "../../hooks/useAsync";
import { useSiteRuntime } from "../../runtime/context";
import { reportsApi } from "../../services";
import { notify } from "../../stores/toast";

/** Export / Import buttons for one report, shown only when the caller's role allows them. */
export function ReportActions({ reportKey }: { reportKey: string }) {
  const { siteId } = useSiteRuntime();
  const reports = useAsync(() => reportsApi.list(siteId), [siteId]);
  const report = reports.data?.find((r) => r.key === reportKey);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  if (!report) return null;

  const doExport = async () => {
    setExporting(true);
    try {
      const { blob, fileName } = await reportsApi.export(siteId, report.key);
      saveBlob(blob, fileName);
      const masked = report.columns.filter((c) => c.masked).length;
      notify.success(masked > 0 ? `Exported ${report.title}. ${masked} confidential column(s) are locked for your role.` : `Exported ${report.title}.`);
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {report.canExport && (
        <Button onClick={doExport} loading={exporting}>
          {!exporting && <Download className="h-4 w-4" aria-hidden />} Export Excel
        </Button>
      )}
      {report.canImport && (
        <Button onClick={() => setImporting(true)}>
          <Upload className="h-4 w-4" aria-hidden /> Import Excel
        </Button>
      )}
      {importing && <ImportDialog siteId={siteId} report={report} onClose={() => setImporting(false)} />}
    </>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "checking"; file: File }
  | { kind: "ready"; file: File; result: ImportResult }
  | { kind: "rejected"; file: File; message: string; errors: ImportRowError[] }
  | { kind: "importing"; file: File; result: ImportResult }
  | { kind: "done"; result: ImportResult };

const rowErrors = (e: ApiRequestError): ImportRowError[] =>
  (e.details ?? []).map((d) => ({ row: d.row ?? 0, column: d.column ?? d.path, message: d.message }));

export function ImportDialog({ siteId, report, onClose }: { siteId: string; report: ReportAccess; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const check = async (file: File) => {
    if (file.size > REPORT_MAX_BYTES) {
      setPhase({ kind: "rejected", file, message: `File is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB. 0 rows written to database.`, errors: [] });
      return;
    }
    setPhase({ kind: "checking", file });
    try {
      setPhase({ kind: "ready", file, result: await reportsApi.import(siteId, report.key, file, true) });
    } catch (e) {
      const err = toRequestError(e);
      setPhase({ kind: "rejected", file, message: err.message, errors: rowErrors(err) });
    }
  };
  const commit = async (file: File, result: ImportResult) => {
    setPhase({ kind: "importing", file, result });
    try {
      const done = await reportsApi.import(siteId, report.key, file, false);
      setPhase({ kind: "done", result: done });
      notify.success(`Imported ${done.written} rows from ${done.fileName}`);
    } catch (e) {
      const err = toRequestError(e);
      setPhase({ kind: "rejected", file, message: err.message, errors: rowErrors(err) });
    }
  };
  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDragging(false);
    const f = ev.dataTransfer.files[0];
    if (f) void check(f);
  };

  const importable = report.columns.filter((c) => c.importable);
  const busy = phase.kind === "checking" || phase.kind === "importing";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Import ${report.title}`} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-ui bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Import {report.title}</h2>
            <p className="text-sm text-muted">All-or-nothing: if any cell is invalid, nothing is written.</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-muted hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-3 rounded-ui border border-line bg-slate-50 p-3 text-xs">
          <p className="mb-1 font-medium">Format: first worksheet, header in row 1, max {REPORT_MAX_ROWS.toLocaleString()} rows, .xlsx up to 5 MB. New SKUs only.</p>
          <ul className="flex flex-wrap gap-1.5">
            {importable.map((c) => (
              <li key={c.key}>
                <Badge tone={c.masked ? "warning" : c.required ? "info" : "neutral"}>
                  {c.masked && <Lock className="mr-1 h-3 w-3" aria-hidden />}
                  {c.header}{c.required ? " *" : ""}{c.masked ? " (locked for your role — leave blank)" : ""}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        {phase.kind !== "done" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-ui border-2 border-dashed p-6 text-center ${dragging ? "border-accent bg-accent/5" : "border-line"}`}
          >
            <FileSpreadsheet className="h-7 w-7 text-muted" aria-hidden />
            <p className="text-sm">Drag an .xlsx file here, or</p>
            <Button onClick={() => input.current?.click()} disabled={busy}>Choose file</Button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Excel file"
              data-testid="import-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = ""; }}
            />
          </div>
        )}

        <div aria-live="polite" className="mt-3">
          {phase.kind === "checking" && <p className="text-sm text-muted">Validating {phase.file.name}…</p>}
          {phase.kind === "ready" && (
            <div className="rounded-ui border border-green-300 bg-green-50 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-green-800"><CheckCircle2 className="h-4 w-4" aria-hidden /> {phase.file.name}: all {phase.result.rowCount} rows are valid</p>
              <p className="mt-0.5 text-xs text-green-900">{phase.result.rowCount} new inventory items and their opening-balance ledger entries will be created in one transaction.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" onClick={() => commit(phase.file, phase.result)}>Import {phase.result.rowCount} rows</Button>
                <Button onClick={() => setPhase({ kind: "idle" })}>Choose another file</Button>
              </div>
            </div>
          )}
          {phase.kind === "importing" && <p className="text-sm text-muted">Importing {phase.result.rowCount} rows…</p>}
          {phase.kind === "done" && (
            <div className="rounded-ui border border-success/40 bg-success/10 p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Imported {phase.result.written} rows from {phase.result.fileName}</p>
              <Button className="mt-3" onClick={() => window.location.reload()}>Refresh table</Button>
            </div>
          )}
          {phase.kind === "rejected" && (
            <div role="alert" className="rounded-ui border border-danger/40 bg-danger/10 p-3 text-sm">
              <p className="font-medium text-danger">Import rejected — {phase.file.name}</p>
              <p className="mt-0.5 text-danger/80">{phase.message}</p>
              {phase.errors.length > 0 && (
                <div className="mt-2 max-h-60 overflow-auto rounded-ui border border-border bg-surface">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Rows that failed validation</caption>
                    <thead className="sticky top-0 bg-secondary-bg text-secondary">
                      <tr><th className="px-2 py-1 font-mono uppercase">Row</th><th className="px-2 py-1 font-mono uppercase">Column</th><th className="px-2 py-1 font-mono uppercase">Problem</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {phase.errors.map((er, i) => (
                        <tr key={i}><td className="px-2 py-1 font-mono font-medium text-primary">{er.row}</td><td className="px-2 py-1 text-secondary">{er.column}</td><td className="px-2 py-1 text-danger">{er.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Button className="mt-3" onClick={() => setPhase({ kind: "idle" })}>Try another file</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
