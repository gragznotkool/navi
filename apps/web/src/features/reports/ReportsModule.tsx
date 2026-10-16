import { Download } from "lucide-react";
import { useState } from "react";
import { Button, PageHeader, Panel } from "../../components/ui";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { excelApi } from "../../services";
import { notify } from "../../stores/toast";

const REPORTS = [
  { kind: "reports/inventory" as const, name: "inventory", title: "Inventory", text: "Every item with quantity, reorder level and your item fields.", permission: "inventory:view" },
  { kind: "reports/requests" as const, name: "requests", title: "Requests", text: "One row per request line with status and dates.", permission: "request:view" },
];

/** Excel exports of this site's own data. Text that could run as a formula is neutralized on the server. */
export function ReportsModule({ page }: ModuleProps) {
  const { siteId, slug, permissions } = useSiteRuntime();
  const [busy, setBusy] = useState<string | null>(null);
  const available = REPORTS.filter((r) => permissions.has(r.permission));

  const download = async (r: (typeof REPORTS)[number]) => {
    setBusy(r.kind);
    try {
      const blob = await excelApi.download(siteId, r.kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}-${r.name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify.error(toRequestError(e).message || "The download failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title={page.title} subtitle="Download this site's data as an Excel workbook." />
      {available.length === 0 ? (
        <p className="text-sm text-muted">Your role cannot export any data from this site.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {available.map((r) => (
            <Panel key={r.kind} title={r.title}>
              <p className="mb-3 text-sm text-muted">{r.text}</p>
              <Button onClick={() => void download(r)} loading={busy === r.kind}><Download className="h-3.5 w-3.5" aria-hidden /> Download {r.title.toLowerCase()} (.xlsx)</Button>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
