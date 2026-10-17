import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProofList, ProofResult } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { trustApi } from "../../services";

const tone = { "not-run": "neutral", passed: "success", failed: "danger" } as const;
const label = { "not-run": "Not run", passed: "Passed", failed: "Failed" } as const;
const proofTone = { "not-run": "neutral", pass: "success", fail: "danger", error: "danger" } as const;
const proofLabel = { "not-run": "Not run", pass: "Passed", fail: "Failed", error: "Error" } as const;

/** One square per check. Status is shown by glyph and text, not colour alone. */
function Dot({ name, ok }: { name: string; ok: boolean }) {
  return (
    <span
      role="img"
      aria-label={`${name}: ${ok ? "passed" : "failed"}`}
      title={`${name}: ${ok ? "passed" : "failed"}`}
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white ${ok ? "bg-success" : "bg-danger"}`}
    >
      {ok ? "✓" : "✗"}
    </span>
  );
}

function ProofRow({ definition, result, running, onRun }: { definition: ProofList["proofs"][number]["definition"]; result: ProofResult; running: boolean; onRun: () => void }) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{definition.title}</p>
          <p className="text-xs text-muted">{definition.description}</p>
          {definition.writesToLab && <p className="text-xs text-muted">Writes test rows into the reserved lab site only.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={proofTone[result.status]}>{proofLabel[result.status]}</Badge>
          <Button onClick={onRun} loading={running} aria-label={`Run proof: ${definition.title}`}>Run</Button>
        </div>
      </div>
      {result.cells.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label={`${definition.title} results`}>
          {result.cells.map((c) => <Dot key={c.label} name={c.label} ok={c.ok} />)}
        </div>
      )}
      {result.error && <p role="alert" className="mt-2 text-xs text-danger">Proof could not complete: {result.error}</p>}
      {result.status !== "not-run" && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-mono uppercase text-muted hover:text-primary">
            Evidence · ran {result.ranAt ? formatDateTime(result.ranAt) : ""} · {result.durationMs} ms
          </summary>
          <ul className="mt-2 divide-y divide-border rounded border border-border bg-[#111313] font-mono">
            {result.cells.map((c) => (
              <li key={c.label} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
                <span className={c.ok ? "text-success font-medium" : "text-danger font-medium"}>{c.ok ? "✓" : "✗"} {c.label}</span>
                <span className="text-right text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
          {Object.keys(result.evidence).length > 0 && (
            <dl className="mt-2 rounded border border-border bg-[#0d0f0e] p-2.5 font-mono text-[11px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
              {Object.entries(result.evidence).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-secondary">{k}</dt><dd className="text-primary truncate">{String(v)}</dd></div>
              ))}
            </dl>
          )}
        </details>
      )}
    </li>
  );
}

export function TrustConsolePage() {
  const proofs = useAsync(() => trustApi.proofs(), []);
  const checks = useAsync(() => trustApi.checks(), []);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ProofResult>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (id: string) => {
    setRunning((s) => new Set(s).add(id));
    setFailure(null);
    try {
      const r = await trustApi.runProof(id);
      setResults((x) => ({ ...x, [id]: r }));
    } catch (e) {
      setFailure(toRequestError(e).message);
    } finally {
      setRunning((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };
  const runAll = async () => {
    for (const p of proofs.data?.proofs ?? []) await run(p.definition.id);
  };

  const rows = (proofs.data?.proofs ?? []).map((p) => ({ definition: p.definition, result: results[p.definition.id] ?? p.last }));
  const total = rows.reduce((n, r) => n + r.result.cells.length, 0);
  const passing = rows.reduce((n, r) => n + r.result.cells.filter((c) => c.ok).length, 0);

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <Link to="/" className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-muted hover:text-[#FFE500]">
        ← RETURN TO HUB
      </Link>
      <div className="mt-2 flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold uppercase tracking-wider text-primary">Security & Trust Verification Console</h1>
          <p className="mt-1 text-xs text-muted font-mono">
            Direct operational verification suite. Proofs execute live against Postgres isolation policies and active schemas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
          <span className="font-mono text-xs uppercase text-success">REALTIME ENGINE ACTIVE</span>
        </div>
      </div>
      {proofs.loading && !proofs.data && <LoadingState />}
      {proofs.error ? <ErrorState error={proofs.error} onRetry={proofs.reload} /> : null}
      {proofs.data && (
        <>
          <div className="mt-4">
            <Panel title="ENVIRONMENT TELEMETRY">
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                <div className="rounded border border-border bg-[#111313] p-2.5">
                  <dt className="text-muted uppercase text-[10px]">Runtime Mode</dt>
                  <dd className="mt-1 text-sm font-semibold text-primary">{proofs.data.environment.nodeEnv}</dd>
                </div>
                <div className="rounded border border-border bg-[#111313] p-2.5">
                  <dt className="text-muted uppercase text-[10px]">Database Engine</dt>
                  <dd className="mt-1 text-sm font-semibold text-primary">{proofs.data.environment.database}</dd>
                </div>
                <div className="rounded border border-border bg-[#111313] p-2.5">
                  <dt className="text-muted uppercase text-[10px]">Connected Role</dt>
                  <dd className="mt-1 text-sm font-semibold text-[#FFE500]">{proofs.data.environment.databaseRole}</dd>
                </div>
                <div className="rounded border border-border bg-[#111313] p-2.5">
                  <dt className="text-muted uppercase text-[10px]">Reserved Lab Site</dt>
                  <dd className="mt-1 text-sm font-semibold text-primary">{proofs.data.environment.labSite}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted font-mono">{proofs.data.environment.note}</p>
            </Panel>
          </div>
          <div className="mt-4">
            <Panel
              title={total > 0 ? `LIVE PROOFS · ${passing} OF ${total} CHECKS PASSING` : "LIVE PROOFS"}
              actions={<Button variant="primary" onClick={runAll} loading={running.size > 0} className="uppercase font-mono">Run all proofs</Button>}
            >
              {failure && <p role="alert" className="mb-2 rounded border border-danger/40 bg-danger/10 p-2 text-xs font-mono text-danger">{failure}</p>}
              <ul className="divide-y divide-border">
                {rows.map((r) => (
                  <ProofRow key={r.definition.id} definition={r.definition} result={r.result} running={running.has(r.definition.id)} onRun={() => void run(r.definition.id)} />
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
      {checks.data && (
        <div className="mt-4">
          <Panel title={checks.data.generatedAt ? `RECORDED TEST SUITE · LAST ${formatDateTime(checks.data.generatedAt)}` : "RECORDED TEST-SUITE RUNS"}>
            <p className="mb-3 text-xs text-muted font-mono">Automated CI test suite results verified on the host API instance.</p>
            <ul className="divide-y divide-border">
              {checks.data.checks.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-primary">{c.label}</p>
                    {c.detail && <p className="text-xs text-muted font-mono">{c.detail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge>{c.environment === "test" ? "TEST ENV" : "PROD"}</Badge>
                    <Badge tone={tone[c.status]}>{label[c.status].toUpperCase()}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </main>
  );
}
