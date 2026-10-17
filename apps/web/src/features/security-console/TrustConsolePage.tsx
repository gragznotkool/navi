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
      className={`inline-flex h-5 w-5 items-center justify-center rounded-[2px] font-mono text-[11px] font-bold text-[#080909] ${
        ok ? "bg-[#39D98A]" : "bg-[#FF5C5C]"
      }`}
    >
      {ok ? "✓" : "✗"}
    </span>
  );
}

function ProofRow({
  definition,
  result,
  running,
  onRun,
}: {
  definition: ProofList["proofs"][number]["definition"];
  result: ProofResult;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-[#F5F5F0]">{definition.title}</p>
          <p className="font-mono text-xs text-[#A5A8A6]">{definition.description}</p>
          {definition.writesToLab && (
            <p className="font-mono text-[11px] text-[#FFE500]">
              Writes test rows into the reserved lab site only.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={proofTone[result.status]}>{proofLabel[result.status]}</Badge>
          <Button
            onClick={onRun}
            loading={running}
            aria-label={`Run proof: ${definition.title}`}
            className="uppercase font-mono text-xs"
          >
            Run
          </Button>
        </div>
      </div>
      {result.cells.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label={`${definition.title} results`}>
          {result.cells.map((c) => (
            <Dot key={c.label} name={c.label} ok={c.ok} />
          ))}
        </div>
      )}
      {result.error && (
        <p role="alert" className="mt-2 font-mono text-xs text-[#FF5C5C]">
          Proof could not complete: {result.error}
        </p>
      )}
      {result.status !== "not-run" && (
        <details className="mt-2 font-mono text-xs">
          <summary className="cursor-pointer text-[#A5A8A6] hover:text-[#FFE500]">
            Evidence · ran {result.ranAt ? formatDateTime(result.ranAt) : ""} · {result.durationMs} ms
          </summary>
          <ul className="mt-2 divide-y divide-[#303432] rounded-[3px] border border-[#303432] bg-[#111313]">
            {result.cells.map((c) => (
              <li key={c.label} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
                <span className={c.ok ? "text-[#39D98A] font-medium" : "text-[#FF5C5C] font-medium"}>
                  {c.ok ? "✓" : "✗"} {c.label}
                </span>
                <span className="text-right text-[#A5A8A6]">{c.detail}</span>
              </li>
            ))}
          </ul>
          {Object.keys(result.evidence).length > 0 && (
            <dl className="mt-2 rounded-[3px] border border-[#303432] bg-[#0d0f0e] p-2.5 font-mono text-[11px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[#A5A8A6]">
              {Object.entries(result.evidence).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[#777C79] uppercase">{k}</dt>
                  <dd className="text-[#F5F5F0] truncate">{String(v)}</dd>
                </div>
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
  const [isoTrigger, setIsoTrigger] = useState(0);
  const isolation = useAsync(async () => {
    if (!trustApi.isolationCheck || isoTrigger === 0) return null;
    return trustApi.isolationCheck();
  }, [isoTrigger]);

  const [invTrigger, setInvTrigger] = useState(0);
  const inventory = useAsync(async () => {
    if (!trustApi.inventoryCheck || invTrigger === 0) return null;
    return trustApi.inventoryCheck();
  }, [invTrigger]);

  const audit = useAsync(async () => {
    if (!trustApi.auditEvents) return null;
    return trustApi.auditEvents();
  }, []);

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

  const rows = (proofs.data?.proofs ?? []).map((p) => ({
    definition: p.definition,
    result: results[p.definition.id] ?? p.last,
  }));
  const total = rows.reduce((n, r) => n + r.result.cells.length, 0);
  const passing = rows.reduce((n, r) => n + r.result.cells.filter((c) => c.ok).length, 0);

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <Link to="/" className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-wider text-[#A5A8A6] hover:text-[#FFE500]">
        ← RETURN TO HUB
      </Link>
      <div className="mt-2 flex items-center justify-between border-b border-[#303432] pb-4">
        <div>
          <h1 className="font-['Barlow_Condensed',sans-serif] text-2xl font-black uppercase tracking-wider text-[#F5F5F0]">
            Security and Trust Console
          </h1>
          <p className="mt-1 font-mono text-xs text-[#A5A8A6]">
            Proofs run live against this API and database right now. A proof shows “Not run” until you run it, and its verdict comes only from what the run observed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#39D98A] animate-pulse" />
          <span className="font-mono text-xs uppercase text-[#39D98A]">REALTIME ENGINE ACTIVE</span>
        </div>
      </div>

      {proofs.loading && !proofs.data && <LoadingState />}
      {proofs.error ? <ErrorState error={proofs.error} onRetry={proofs.reload} /> : null}
      {proofs.data && (
        <>
          <div className="mt-4">
            <Panel title="ENVIRONMENT TELEMETRY">
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
                <div className="rounded-[2px] border border-[#303432] bg-[#111313] p-2.5">
                  <dt className="text-[#777C79] uppercase text-[10px]">Runtime Mode</dt>
                  <dd className="mt-1 text-sm font-semibold text-[#F5F5F0]">{proofs.data.environment.nodeEnv}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#111313] p-2.5">
                  <dt className="text-[#777C79] uppercase text-[10px]">Database Engine</dt>
                  <dd className="mt-1 text-sm font-semibold text-[#F5F5F0]">{proofs.data.environment.database}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#111313] p-2.5">
                  <dt className="text-[#777C79] uppercase text-[10px]">Connected Role</dt>
                  <dd className="mt-1 text-sm font-semibold text-[#FFE500]">{proofs.data.environment.databaseRole}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#111313] p-2.5">
                  <dt className="text-[#777C79] uppercase text-[10px]">Reserved Lab Site</dt>
                  <dd className="mt-1 text-sm font-semibold text-[#F5F5F0]">{proofs.data.environment.labSite}</dd>
                </div>
              </dl>
              <p className="mt-3 font-mono text-xs text-[#A5A8A6]">{proofs.data.environment.note}</p>
            </Panel>
          </div>

          <div className="mt-4">
            <Panel
              title={total > 0 ? `Live proofs · ${passing} of ${total} checks passing` : "Live proofs"}
              actions={
                <Button variant="primary" onClick={runAll} loading={running.size > 0} className="uppercase font-mono">
                  Run all proofs
                </Button>
              }
            >
              {failure && (
                <p role="alert" className="mb-2 rounded-[2px] border border-[#FF5C5C]/40 bg-[#FF5C5C]/10 p-2 font-mono text-xs text-[#FF5C5C]">
                  {failure}
                </p>
              )}
              <ul className="divide-y divide-[#303432]">
                {rows.map((r) => (
                  <ProofRow
                    key={r.definition.id}
                    definition={r.definition}
                    result={r.result}
                    running={running.has(r.definition.id)}
                    onRun={() => void run(r.definition.id)}
                  />
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}

      {checks.data && (
        <div className="mt-4">
          <Panel
            title={
              checks.data.generatedAt
                ? `Recorded test-suite runs · last ${formatDateTime(checks.data.generatedAt)}`
                : "Recorded test-suite runs · none recorded"
            }
          >
            <p className="mb-3 font-mono text-xs text-[#A5A8A6]">
              These come from the automated test suite on the API host (test environment), not from this deployment. “Not run” means nobody has run the tests here.
            </p>
            <ul className="divide-y divide-[#303432]">
              {checks.data.checks.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div>
                    <p className="font-mono text-sm font-medium text-[#F5F5F0]">{c.label}</p>
                    {c.detail && <p className="font-mono text-xs text-[#A5A8A6]">{c.detail}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge>{c.environment === "test" ? "TEST ENV" : "PROD"}</Badge>
                    <Badge tone={tone[c.status]}>{label[c.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* Tenant Isolation Panel */}
      <div className="mt-4">
        <Panel
          title="Tenant Isolation Live Invariant"
          actions={
            <Button
              onClick={() => setIsoTrigger((i) => i + 1)}
              loading={isolation.loading}
              aria-label="Run isolation check"
              className="uppercase font-mono text-xs"
            >
              Run isolation check
            </Button>
          }
        >
          {isolation.loading && !isolation.data && <LoadingState />}
          {isolation.error ? <ErrorState error={isolation.error} onRetry={isolation.reload} /> : null}
          {isolation.data && (
            <div className="font-mono text-xs">
              <div className="flex items-center gap-2">
                <Badge tone={tone[isolation.data.passed ? "passed" : "failed"]}>
                  {label[isolation.data.passed ? "passed" : "failed"]}
                </Badge>
                <span className="font-medium text-[#F5F5F0]">{isolation.data.detail}</span>
              </div>
              <p className="mt-1 text-[11px] text-[#A5A8A6]">
                Proves that the active platform user is strictly blocked from resolving tenant access or querying unauthorized site data.
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* Inventory Integrity Invariant Panel */}
      <div className="mt-4">
        <Panel
          title="Inventory Integrity Live Invariant"
          actions={
            <Button
              onClick={() => setInvTrigger((i) => i + 1)}
              loading={inventory.loading}
              aria-label="Run inventory check"
              className="uppercase font-mono text-xs"
            >
              Run inventory check
            </Button>
          }
        >
          {inventory.loading && !inventory.data && <LoadingState />}
          {inventory.error ? <ErrorState error={inventory.error} onRetry={inventory.reload} /> : null}
          {inventory.data && (
            <div className="font-mono text-xs">
              <div className="flex items-center gap-2">
                <Badge tone={tone[inventory.data.passed ? "passed" : "failed"]}>
                  {label[inventory.data.passed ? "passed" : "failed"]}
                </Badge>
                <span className="font-medium text-[#F5F5F0]">{inventory.data.detail}</span>
              </div>
              <p className="mt-1 text-[11px] text-[#A5A8A6]">
                Verifies zero negative onHand levels, zero ledger sum mismatches, and zero duplicate ledger entries.
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* Audit Activity Stream */}
      {audit.data && audit.data.length > 0 && (
        <div className="mt-4">
          <Panel title="System Audit Stream (last 200 events)">
            <ul className="divide-y divide-[#303432] max-h-72 overflow-y-auto font-mono text-xs">
              {audit.data.map((e) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold text-[#F5F5F0]">{e.action}</span>
                    {e.entityType && <span className="text-[11px] text-[#FFE500] ml-2">[{e.entityType}]</span>}
                  </span>
                  <span className="text-[11px] text-[#777C79]">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </main>
  );
}
