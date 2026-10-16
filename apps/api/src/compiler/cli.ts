import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileConfiguration } from "./compile.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../../../config/sites");

const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let failed = 0;

for (const file of files) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON (${e instanceof Error ? e.message : "unknown"})`);
    failed += 1;
    continue;
  }
  const { result } = compileConfiguration(parsed);
  if (result.valid) {
    console.log(`OK   ${file} (${result.warnings.length} warning(s))`);
  } else {
    failed += 1;
    console.error(`FAIL ${file}`);
    for (const i of result.errors) console.error(`  [${i.stage}] ${i.code}: ${i.message}${i.path ? ` (${i.path})` : ""}`);
  }
  for (const w of result.warnings) console.warn(`  warn [${w.stage}] ${w.code}: ${w.message}`);
}

if (files.length === 0) {
  console.error(`No site configurations found in ${dir}`);
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
