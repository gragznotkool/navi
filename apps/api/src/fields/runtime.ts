import type { FieldDefinition, FieldEntity, SiteConfiguration } from "@opshub/contracts";
import { AppError } from "../utils/errors.js";

export type Extras = Record<string, unknown>;

const fieldsOf = (config: SiteConfiguration, entity: FieldEntity): FieldDefinition[] => config.fields.filter((f) => f.entity === entity);

function checkValue(f: FieldDefinition, v: unknown): string | null {
  switch (f.type) {
    case "text":
      return typeof v === "string" && v.length <= 500 ? null : "must be text of at most 500 characters";
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "must be a number";
    case "boolean":
      return typeof v === "boolean" ? null : "must be true or false";
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : "must be a date (YYYY-MM-DD)";
  }
}

/**
 * Validates submitted values against the ACTIVE configuration's fields. Known fields (visible or hidden)
 * are accepted so a client holding an older config can't lose data; unknown keys are rejected.
 * Required-ness is enforced only for visible fields. `null` means "clear this value" when `allowClear`.
 */
export function validateExtras(config: SiteConfiguration, entity: FieldEntity, input: Extras | undefined, opts: { requireAll: boolean; allowClear?: boolean }): Extras {
  const defs = new Map(fieldsOf(config, entity).map((f) => [f.key, f]));
  const out: Extras = {};
  const problems: { path: string; message: string }[] = [];
  for (const [key, value] of Object.entries(input ?? {})) {
    const def = defs.get(key);
    if (!def) {
      problems.push({ path: `extras.${key}`, message: "is not a field on this site" });
      continue;
    }
    if (value === null && opts.allowClear) {
      out[key] = null;
      continue;
    }
    const bad = checkValue(def, value);
    if (bad) problems.push({ path: `extras.${key}`, message: `${def.label} ${bad}` });
    else out[key] = value;
  }
  if (opts.requireAll) {
    for (const def of defs.values()) {
      if (def.required && !def.hidden && (out[def.key] === undefined || out[def.key] === null || out[def.key] === "")) {
        problems.push({ path: `extras.${def.key}`, message: `${def.label} is required` });
      }
    }
  }
  if (problems.length) throw new AppError(422, "invalid_fields", "Some field values are not valid", problems);
  return out;
}

/** Values safe to show: hidden and undefined fields are stripped (they remain stored in the database). */
export function visibleExtras(config: SiteConfiguration, entity: FieldEntity, stored: unknown): Extras {
  const out: Extras = {};
  if (typeof stored !== "object" || stored === null) return out;
  const values = stored as Extras;
  for (const f of fieldsOf(config, entity)) if (!f.hidden && values[f.key] !== undefined) out[f.key] = values[f.key];
  return out;
}
