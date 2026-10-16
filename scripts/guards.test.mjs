import assert from "node:assert/strict";
import { test } from "node:test";
import { evalRules, runGuards, scanText, secretRules, slugRules } from "./guards.mjs";

const ids = (text, rules, opts) => scanText(text, rules, opts).map((h) => h.rule);

test("slug guard catches branching on a site slug or hard-coded site names", () => {
  assert.deepEqual(ids('if (siteSlug === "distribution") {}', slugRules), ["slug-compare", "site-literal"]);
  assert.ok(ids("if (slug !== 'x') {}", slugRules).includes("slug-compare"));
  assert.ok(ids("switch (config.slug) { }", slugRules).includes("slug-switch"));
  assert.ok(ids('const t = "Central Stores";', slugRules).includes("site-literal"));
  assert.deepEqual(ids("const slug = route.params.slug;", slugRules), []); // reading a slug is fine
  assert.deepEqual(ids('// siteSlug === "distribution" is forbidden', slugRules), []); // comments may mention it
});

test("eval ban catches eval, new Function and string timers, but not lookalikes", () => {
  assert.deepEqual(ids("eval(code)", evalRules), ["eval"]);
  assert.deepEqual(ids("const f = new Function('a', 'return a');", evalRules), ["new-function"]);
  assert.deepEqual(ids("setTimeout('alert(1)', 10)", evalRules), ["string-timer"]);
  assert.deepEqual(ids("retrieval(x); model.eval(y); evaluate(z); setTimeout(() => 1, 5)", evalRules), []);
});

test("secret scan catches real-looking credentials and ignores placeholders", () => {
  const fake = {
    google: "AIza" + "A".repeat(35),
    aws: "AKIA" + "B".repeat(16),
    gh: "ghp_" + "c".repeat(36),
    anthropic: "sk-ant-" + "d".repeat(30),
    key: "-----BEGIN RSA PRIVATE KEY-----",
    url: "postgres://admin:Sup3rS3cretPw@db.example.com/app",
  };
  for (const [name, value] of Object.entries(fake)) assert.ok(scanText(`x = "${value}"`, secretRules, { skipComments: false }).length > 0, name);
  assert.deepEqual(scanText("DATABASE_URL=postgres://opshub_app:change-me-app@localhost:5432/opshub", secretRules, { skipComments: false }), []);
  assert.deepEqual(scanText("GEMINI_API_KEY=", secretRules, { skipComments: false }), []);
});

test("runGuards applies each rule only where it belongs", () => {
  const files = {
    "apps/web/src/runtime/Bad.tsx": 'if (slug === "distribution") {}',
    "apps/web/src/features/Ok.tsx": 'if (slug === "distribution") {}', // outside the generic-runtime scope
    "apps/api/src/services/Eval.ts": "eval(x)",
    "apps/api/tests/unit/Eval.test.ts": "eval(x)", // tests may exercise hostile input
    "apps/api/src/config/Key.ts": 'const k = "AIza' + "Z".repeat(35) + '";',
    ".env.example": "GEMINI_API_KEY=AIza" + "Z".repeat(35),
  };
  const problems = runGuards(Object.keys(files), (f) => files[f]);
  assert.deepEqual(
    [...new Set(problems.map((p) => `${p.guard}:${p.file}`))].sort(),
    ["eval:apps/api/src/services/Eval.ts", "secret:apps/api/src/config/Key.ts", "slug:apps/web/src/runtime/Bad.tsx"],
  );
  assert.ok(problems.every((p) => p.guard !== "secret" || p.text === "(redacted)")); // never echo the secret
});

test("the real repository passes its own guards", () => {
  assert.deepEqual(runGuards(), []);
});
