// CI guard: the universal renderer must never choose behaviour from site identity.
// AST-based, so slugs in seed data, docs, and tests are NOT flagged; only rendering-code branching is.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import fs from "node:fs";
import path from "node:path";

const SEEDED_SLUGS = ["central-stores", "service-centre", "distribution"];
const SLUG_NAMES = new Set(["slug", "siteSlug", "siteName"]);

const isSlugRef = (n: any) =>
  n &&
  ((n.type === "Identifier" && SLUG_NAMES.has(n.name)) ||
    ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && !n.computed && SLUG_NAMES.has(n.property?.name)));

const isStr = (n: any) => n && (n.type === "StringLiteral" || (n.type === "TemplateLiteral" && n.expressions.length === 0));

export function findViolations(code: string, file = "inline") {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  const out: string[] = [];
  const add = (n: any, why: string) => out.push(`${file}:${n.loc.start.line} ${why}`);

  (function walk(n: any) {
    if (!n || typeof n.type !== "string") return;
    if (
      n.type === "BinaryExpression" &&
      ["==", "===", "!=", "!=="].includes(n.operator) &&
      ((isSlugRef(n.left) && isStr(n.right)) || (isSlugRef(n.right) && isStr(n.left)))
    ) {
      add(n, "compares site slug/name to a literal");
    }
    if (n.type === "SwitchStatement" && isSlugRef(n.discriminant)) {
      add(n, "switch on site slug");
    }
    if ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && n.computed && isSlugRef(n.property)) {
      add(n, "indexes a registry by site slug");
    }
    if (n.type === "StringLiteral" && SEEDED_SLUGS.includes(n.value)) {
      add(n, `hardcodes seeded slug "${n.value}"`);
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === "string") walk(v);
    }
  })(ast.program);

  return out;
}

const walkDir = (d: string): string[] =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walkDir(path.join(d, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [path.join(d, e.name)] : []));

describe("no site-specific branching in rendering code", () => {
  it("production source is clean", () => {
    const files = walkDir(path.resolve(__dirname, "../src"));
    const violations = files.flatMap((f) => findViolations(fs.readFileSync(f, "utf8"), path.relative(process.cwd(), f)));
    expect(violations).toEqual([]);
  });

  it("detects forbidden patterns (guard self-test)", () => {
    expect(findViolations(`const P = site.slug === "central-stores" ? A : B;`)).not.toEqual([]);
    expect(findViolations(`function f() { switch (site.slug) { case 'x': return 1; } }`)).not.toEqual([]);
    expect(findViolations(`const C = PAGES[site.slug];`)).not.toEqual([]);
    expect(findViolations(`if (slug === 'distribution') {}`)).not.toEqual([]);
  });

  it("allows legitimate slug usage", () => {
    expect(findViolations(`const s = sites.find((x) => x.slug === slug); nav('/s/' + site.slug);`)).toEqual([]);
  });
});
