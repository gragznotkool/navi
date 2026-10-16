import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Reporter, TestModule } from "vitest/node";

const file = resolve(__dirname, "../../test-results/trust.json");

/** Records per-file pass/fail so the Trust Console shows real results. Merges across separate runs. */
export default class TrustReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const current: { files: Record<string, unknown> } = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { files: Record<string, unknown> }) : { files: {} };
    for (const m of modules) {
      const state = m.state();
      if (state !== "passed" && state !== "failed") continue;
      const failed = [...m.children.allTests("failed")].map((t) => t.fullName);
      current.files[basename(m.moduleId)] = { state, ranAt: new Date().toISOString(), failed };
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(current, null, 2));
  }
}
