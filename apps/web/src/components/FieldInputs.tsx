import type { InputHTMLAttributes } from "react";
import type { FieldDefinition } from "@opshub/contracts";
import { TextField } from "./ui";

export const visibleFields = (fields: FieldDefinition[], entity: FieldDefinition["entity"]) => fields.filter((f) => f.entity === entity && !f.hidden);

/** Converts raw form input to the value type a field stores; empty input means "no value". */
export function parseFieldValue(type: FieldDefinition["type"], raw: unknown): unknown {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  if (type === "number") return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (type === "boolean") return raw === true || raw === "true";
  return String(raw);
}

const inputType = (t: FieldDefinition["type"]): InputHTMLAttributes<HTMLInputElement>["type"] =>
  t === "number" ? "number" : t === "date" ? "date" : t === "boolean" ? "checkbox" : "text";

/** Controlled editor for one configured field (used outside react-hook-form). */
export function FieldInput({ field, value, onChange, disabled }: { field: FieldDefinition; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }
  return (
    <TextField
      label={`${field.label}${field.required ? " *" : ""}`}
      type={inputType(field.type)}
      step={field.type === "number" ? "any" : undefined}
      disabled={disabled}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(parseFieldValue(field.type, e.target.value))}
    />
  );
}
