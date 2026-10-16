import { Link } from "react-router-dom";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime } from "../../lib/format";
import { trustApi } from "../../services";

const tone = { "not-run": "neutral", passed: "success", failed: "danger" } as const;
const label = { "not-run": "Not run", passed: "Passed", failed: "Failed" } as const;

export function TrustConsolePage() {
  const checks = useAsync(() => trustApi.checks(), []);
  return (
    <main className="mx-auto w-full max-w-4xl p-6">
      <Link to="/" className="text-xs text-muted hover:underline">← Sites</Link>
      <h1 className="mt-1 text-lg font-semibold">Security and Trust Console</h1>
      <p className="mb-4 mt-0.5 text-sm text-muted">
        Results come from test runs recorded on the API host. A check shows “Not run” until its tests have actually been executed. These are test-environment results, not production monitoring.
      </p>
      {checks.loading && <LoadingState />}
      {checks.error ? <ErrorState error={checks.error} onRetry={checks.reload} /> : null}
      {checks.data && (
        <Panel title={checks.data.generatedAt ? `Last recorded run: ${formatDateTime(checks.data.generatedAt)}` : "No test run has been recorded"}>
          <ul className="divide-y divide-line">
            {checks.data.checks.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.detail && <p className="text-xs text-muted">{c.detail}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge>{c.environment === "test" ? "test environment" : "production"}</Badge>
                  <Badge tone={tone[c.status]}>{label[c.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </main>
  );
}
