import type { ReleaseDiffEntry } from "@opshub/contracts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isObject = (v: unknown): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);

/** Arrays of objects with string `id`s are compared by id, so reordering is not reported as a change. */
function keyed(arr: Json[]): Map<string, Json> | null {
  const map = new Map<string, Json>();
  for (const item of arr) {
    if (!isObject(item) || typeof item.id !== "string" || map.has(item.id)) return null;
    map.set(item.id, item);
  }
  return map;
}

/** Deterministic structural diff of two configurations, reported as dotted leaf paths. */
export function diffConfigurations(from: unknown, to: unknown): ReleaseDiffEntry[] {
  const out: ReleaseDiffEntry[] = [];
  const walk = (a: Json | undefined, b: Json | undefined, path: string) => {
    if (a === undefined && b !== undefined) return void out.push({ path, change: "added" });
    if (a !== undefined && b === undefined) return void out.push({ path, change: "removed" });
    if (a === undefined || b === undefined) return;
    if (isObject(a) && isObject(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const ka = keyed(a);
      const kb = keyed(b);
      if (ka && kb) {
        for (const id of [...new Set([...ka.keys(), ...kb.keys()])].sort()) walk(ka.get(id), kb.get(id), `${path}[${id}]`);
      } else {
        for (let i = 0; i < Math.max(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, change: "changed" });
  };
  walk(from as Json, to as Json, "");
  return out;
}
