// Repository guards run in CI (and locally with `npm run guard`):
//   1. slug guard   - runtime/ and services/ code must be configuration driven, never branch on a site slug or name.
//   2. eval ban     - no eval / new Function / string timers in application source.
//   3. secret scan  - no credentials committed in tracked files.
// Pure functions are exported so scripts/guards.test.mjs can prove each rule catches what it should.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Site identities that must never appear as literals in generic runtime code. */
const SITE_LITERALS = ["central-stores", "service-centre", "distribution", "Central Stores", "Service Centre", "Distribution"];

export const slugRules = [
  { id: "slug-compare", re: /\b(?:siteSlug|slug)\s*[!=]==?\s*["'`]/, why: "branches on a site slug" },
  { id: "slug-switch", re: /switch\s*\(\s*(?:\w+\.)*(?:siteSlug|slug)\s*\)/, why: "switches on a site slug" },
  { id: "site-literal", re: new RegExp(`["'\`](?:${SITE_LITERALS.join("|")})["'\`]`), why: "hard-codes a site slug or name" },
];

export const evalRules = [
  { id: "eval", re: /(?<![\w.$])eval\s*\(/, why: "uses eval" },
  { id: "new-function", re: /\bnew\s+Function\s*\(/, why: "uses new Function" },
  { id: "string-timer", re: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/, why: "passes a string to a timer (implicit eval)" },
];

export const secretRules = [
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "openai-style-key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: "url-password", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:(?!change-me|test-|opshub-dev|\$\{|<|x{3,})[^\s@/]{8,}@/ },
];

/** Lines starting with a comment are ignored by the slug and eval rules (documentation may mention them). */
const isComment = (line) => /^\s*(?:\/\/|\*|\/\*)/.test(line);

/** @returns {{rule: string, line: number, why?: string, text: string}[]} */
export function scanText(text, rules, { skipComments = true } = {}) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (skipComments && isComment(line)) return;
    for (const r of rules) if (r.re.test(line)) hits.push({ rule: r.id, line: i + 1, why: r.why, text: line.trim().slice(0, 160) });
  });
  return hits;
}

export const isSourceFile = (f) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(f);
export const isTestFile = (f) => /(?:^|\/)(?:tests?|e2e|__tests__)\//.test(f) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f);
export const inSlugScope = (f) => /^apps\/web\/src\/(?:runtime|services)\//.test(f) || /^apps\/api\/src\/(?:services|workflows|repositories)\//.test(f);
export const inEvalScope = (f) => /^(?:apps|packages)\/[^/]+\/src\//.test(f) && isSourceFile(f);
/** Placeholders and fixtures that intentionally look like credentials. */
export const secretAllowed = (f) => /(?:^|\/)\.env\.example$/.test(f) || /^scripts\/guards\.(?:test\.)?mjs$/.test(f) || isTestFile(f) || /package-lock\.json$/.test(f);

export function trackedFiles(cwd = root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
}

export function runGuards(files = trackedFiles(), read = (f) => readFileSync(resolve(root, f), "utf8")) {
  const problems = [];
  for (const f of files) {
    if (/\.(?:png|jpe?g|gif|ico|woff2?|xlsx|zip|pdf)$/i.test(f)) continue;
    let text;
    try {
      text = read(f);
    } catch {
      continue; // deleted in the working tree
    }
    if (isSourceFile(f) && !isTestFile(f) && inSlugScope(f)) for (const h of scanText(text, slugRules)) problems.push({ guard: "slug", file: f, ...h });
    if (inEvalScope(f) && !isTestFile(f)) for (const h of scanText(text, evalRules)) problems.push({ guard: "eval", file: f, ...h });
    if (!secretAllowed(f)) for (const h of scanText(text, secretRules, { skipComments: false })) problems.push({ guard: "secret", file: f, ...h, text: "(redacted)" });
  }
  return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = runGuards();
  if (problems.length === 0) {
    console.log("guards: slug, eval and secret checks passed");
  } else {
    for (const p of problems) console.error(`[${p.guard}] ${p.file}:${p.line} ${p.rule}${p.why ? ` (${p.why})` : ""}: ${p.text}`);
    console.error(`\nguards: ${problems.length} problem(s)`);
    process.exit(1);
  }
}
