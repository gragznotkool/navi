import { useState } from "react";
import type { FieldDefinition, SiteConfiguration } from "@opshub/contracts";
import { Badge, Button, Panel, SelectField, TextField } from "../../components/ui";
import { addField, removeField, updateField } from "./configOps";

const ENTITIES: { value: FieldDefinition["entity"]; label: string }[] = [
  { value: "inventory_item", label: "Inventory items" },
  { value: "request_line", label: "Request lines" },
];
const TYPES: FieldDefinition["type"][] = ["text", "number", "boolean", "date"];

const keyFromLabel = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]+/, "").slice(0, 40);

/** Edits `config.fields`. Hiding a field keeps its saved values; the publish dialog says how many rows that affects. */
export function FieldsPanel({ config, onChange }: { config: SiteConfiguration; onChange: (next: SiteConfiguration) => void }) {
  const [label, setLabel] = useState("");
  const [entity, setEntity] = useState<FieldDefinition["entity"]>("inventory_item");
  const [type, setType] = useState<FieldDefinition["type"]>("text");
  const key = keyFromLabel(label);
  const duplicate = config.fields.some((f) => f.entity === entity && f.key === key);

  return (
    <Panel title="Fields">
      {config.fields.length === 0 ? (
        <p className="mb-3 text-sm text-muted">No custom fields yet.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2 text-sm" aria-label="Configured fields">
          {config.fields.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-[#1E293B] bg-slate-50 px-3 py-2 shadow-[2px_2px_0px_#1E293B]">
              <span className="min-w-0">
                <span className="font-bold text-[#0F172A]">{f.label}</span>{" "}
                <span className="text-xs font-medium text-slate-500">{ENTITIES.find((e) => e.value === f.entity)?.label} · {f.type}</span>
                {f.hidden && <> <Badge tone="warning">hidden</Badge></>}
              </span>
              <span className="flex shrink-0 gap-1">
                <Button onClick={() => onChange(updateField(config, f.id, { hidden: !f.hidden }))} aria-label={`${f.hidden ? "Show" : "Hide"} field ${f.label}`}>{f.hidden ? "Show" : "Hide"}</Button>
                <Button variant="danger" onClick={() => onChange(removeField(config, f.id))} aria-label={`Remove field ${f.label}`}>Remove</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <TextField label="New field label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="On" value={entity} onChange={(e) => setEntity(e.target.value as FieldDefinition["entity"])}>
            {ENTITIES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </SelectField>
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as FieldDefinition["type"])}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </SelectField>
        </div>
        {duplicate && <p className="text-xs text-danger" role="alert">A field with this name already exists on that entity.</p>}
        <Button
          disabled={!key || duplicate}
          onClick={() => {
            onChange(addField(config, { entity, key, label: label.trim(), type, required: false, hidden: false }));
            setLabel("");
          }}
        >
          Add field
        </Button>
      </div>
    </Panel>
  );
}
