import { Link } from "react-router-dom";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime } from "../../lib/format";
import { trustApi } from "../../services";
import { useState } from "react";

const tone = { "not-run": "neutral", passed: "success", failed: "danger" } as const;
const label = { "not-run": "Not run", passed: "Passed", failed: "Failed" } as const;

export function TrustConsolePage() {
  // Summary loads on mount
  const summary = useAsync(() => trustApi.summary(), []);

  // Isolation check trigger
  const [isoTrigger, setIsoTrigger] = useState(0);
  const isolation = useAsync(() => trustApi.isolationCheck(), [isoTrigger]);

  // Inventory check trigger
  const [invTrigger, setInvTrigger] = useState(0);
  const inventory = useAsync(() => trustApi.inventoryCheck(), [invTrigger]);

  // Audit events load on mount
  const audit = useAsync(() => trustApi.auditEvents(), []);

  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <Link to="/" className="text-xs text-muted hover:underline">← Sites</Link>
      <h1 className="mt-1 text-lg font-semibold">Security and Trust Console</h1>

      {/* Summary Panel */}
      <Panel title="Trust Summary">
        {summary.loading && <LoadingState />}
        {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
        {summary.data && (
          <div className="space-y-2">
            <p>Generated at: {formatDateTime(summary.data.generatedAt)}</p>
            <p>Isolation: <Badge tone={tone[summary.data.isolation.passed ? "passed" : "failed"]}>{label[summary.data.isolation.passed ? "passed" : "failed"]}</Badge></p>
            <p>Inventory: <Badge tone={tone[summary.data.inventory.passed ? "passed" : "failed"]}>{label[summary.data.inventory.passed ? "passed" : "failed"]}</Badge></p>
          </div>
        )}
      </Panel>

      {/* Tenant Isolation Panel */}
      <Panel title="Tenant Isolation">
        <div className="flex items-center gap-4 mb-2">
          <Button onClick={() => setIsoTrigger((i) => i + 1)} disabled={isolation.loading}>Run Isolation Check</Button>
        </div>
        {isolation.loading && <LoadingState />}
        {isolation.error && <ErrorState error={isolation.error} onRetry={isolation.reload} />}
        {isolation.data && (
          <div>
            <Badge tone={tone[isolation.data.passed ? "passed" : "failed"]}>{label[isolation.data.passed ? "passed" : "failed"]}</Badge>
            <p className="mt-2 text-sm text-muted">{isolation.data.detail}</p>
          </div>
        )}
      </Panel>

      {/* Inventory Integrity Panel */}
      <Panel title="Inventory Integrity">
        <div className="flex items-center gap-4 mb-2">
          <Button onClick={() => setInvTrigger((i) => i + 1)} disabled={inventory.loading}>Run Inventory Check</Button>
        </div>
        {inventory.loading && <LoadingState />}
        {inventory.error && <ErrorState error={inventory.error} onRetry={inventory.reload} />}
        {inventory.data && (
          <div>
            <Badge tone={tone[inventory.data.passed ? "passed" : "failed"]}>{label[inventory.data.passed ? "passed" : "failed"]}</Badge>
            <p className="mt-2 text-sm text-muted">{inventory.data.detail}</p>
          </div>
        )}
      </Panel>

      {/* Audit Activity Panel */}
      <Panel title="Audit Activity (last 200 events)">
        {audit.loading && <LoadingState />}
        {audit.error && <ErrorState error={audit.error} onRetry={audit.reload} />}
        {audit.data && (
          <ul className="divide-y divide-line max-h-96 overflow-y-auto">
            {audit.data.map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <span className="font-medium">{e.action}</span> – {formatDateTime(e.createdAt)}
                {e.siteId && <span> (site {e.siteId})</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}

