import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrustCheckResult } from "@opshub/contracts";

export const TRUST_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../test-results/trust.json");

/** Check definitions: which test file proves which claim. Status only ever comes from recorded runs. */
export const checkDefinitions = [
  { id: "config-validation", label: "Configuration compiler and seed-site validation", file: "compiler.test.ts" },
  { id: "tenant-isolation", label: "Tenant isolation (RLS, role privileges, pooled-connection leakage)", file: "db-security.test.ts" },
  { id: "rbac", label: "Authentication, RBAC and site membership", file: "api.test.ts" },
  { id: "release-lifecycle", label: "Release publish, stale-draft, rollback and audit", file: "api.test.ts" },
  { id: "inventory-concurrency", label: "Inventory concurrency (50 competing allocations)", file: "inventory.test.ts" },
  { id: "ledger-reconciliation", label: "Stock ledger reconciliation and rollback", file: "inventory.test.ts" },
] as const;

export interface RecordedRun {
  files: Record<string, { state: "passed" | "failed"; ranAt: string; failed: string[] }>;
}

export function readChecks(file = TRUST_FILE): { generatedAt: string | null; checks: TrustCheckResult[] } {
  let run: RecordedRun = { files: {} };
  if (existsSync(file)) {
    try {
      run = JSON.parse(readFileSync(file, "utf8")) as RecordedRun;
    } catch {
      run = { files: {} };
    }
  }
  const times = Object.values(run.files).map((f) => f.ranAt).sort();
  const checks: TrustCheckResult[] = checkDefinitions.map((d) => {
    const r = run.files[d.file];
    if (!r) return { id: d.id, label: d.label, status: "not-run", environment: "test", detail: `Run the tests in ${d.file} to record a result.` };
    return {
      id: d.id,
      label: d.label,
      status: r.state,
      environment: "test",
      ranAt: r.ranAt,
      ...(r.failed.length ? { detail: `Failing: ${r.failed.slice(0, 3).join("; ")}` } : {}),
    };
  });
  checks.push(
    { id: "build", label: "Build and CI status", status: "not-run", environment: "test", detail: "CI artifacts are not integrated yet." },
    { id: "production-monitoring", label: "Production monitoring", status: "not-run", environment: "production-monitoring", detail: "No production deployment exists." },
  );
  return { generatedAt: times.length ? times[times.length - 1]! : null, checks };
}
