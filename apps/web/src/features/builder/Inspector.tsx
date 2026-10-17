import { Plus, Trash2 } from "lucide-react";
import type { ModuleDefinition, ModuleNode, SiteConfiguration } from "@opshub/contracts";
import { Badge, Button, Panel, SelectField, TextField } from "../../components/ui";
import {
  addCalculatedField,
  addCustomField,
  removeCalculatedField,
  removeCustomField,
  removeModule,
  setNodeConfig,
  setRolePermission,
  updateCalculatedField,
  updateCustomField,
} from "./configOps";

const VERB_LABEL: Record<string, string> = { view: "Read", create: "Create", record: "Create", manage: "Update", update: "Update", process: "Update", decide: "Decide", export: "Export" };
const labelFor = (permission: string): string => VERB_LABEL[permission.split(":")[1] ?? ""] ?? permission.split(":")[1] ?? permission;

const fieldTypes = ["string", "number", "boolean", "date"] as const;
const calcTypes = ["number", "string", "boolean"] as const;

interface Props {
  config: SiteConfiguration;
  node: ModuleNode | undefined;
  def: ModuleDefinition | undefined;
  defs: readonly ModuleDefinition[];
  onEdit: (next: SiteConfiguration) => void;
  onRemoved: () => void;
  /** Locked templates: only module settings are editable; structure, fields and roles are fixed. */
  settingsOnly?: boolean;
}

/** Right-hand properties sidebar: module settings, custom fields, role access, SLA and calculated fields. */
export function Inspector({ config, node, def, defs, onEdit, onRemoved, settingsOnly = false }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title={def ? def.displayName : "Module settings"}>
        {!node || !def ? (
          <p className="text-sm text-muted">Select a module in the graph to edit its settings, fields and role access.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{def.description}</p>
            {def.configFields.length === 0 && <p className="text-xs text-muted">This module has no configurable settings.</p>}
            {def.configFields.map((f) => (
              <TextField
                key={f.key}
                label={f.label}
                type={f.type === "number" ? "number" : "text"}
                min={f.type === "number" ? 0 : undefined}
                hint={f.key === "slaHours" ? "Pending approvals older than this are flagged as overdue." : f.key === "reminderHours" ? "Approvers are reminded after this long without a decision." : undefined}
                value={String(node.config[f.key] ?? "")}
                onChange={(e) => onEdit(setNodeConfig(config, node.id, f.key, e.target.value === "" ? undefined : f.type === "number" ? Number(e.target.value) : e.target.value))}
              />
            ))}
            {def.type === "approval" && Number(node.config.reminderHours) > Number(node.config.slaHours) && node.config.slaHours !== undefined && (
              <p role="alert" className="text-xs text-danger">Reminder is later than the SLA timeout, so it would never fire.</p>
            )}
            {settingsOnly ? (
              <p className="text-xs text-muted">Template structure is locked. Switch to the Modules tab to add, remove or rewire modules.</p>
            ) : (
            <>
            <Button
              variant="danger"
              disabled={def.platformModule}
              title={def.platformModule ? "Platform modules are mandatory" : undefined}
              onClick={() => {
                onEdit(removeModule(config, node.id, defs));
                onRemoved();
              }}
            >
              Remove module
            </Button>
            {def.platformModule && <p className="text-xs text-muted">Platform modules are mandatory and cannot be removed.</p>}
            </>
            )}
          </div>
        )}
      </Panel>

      {node && def && !settingsOnly && (
        <>
          <Panel title="Custom fields">
            <div className="flex flex-col gap-3">
              {config.customFields.filter((f) => f.nodeId === node.id).map((f) => (
                <div key={f.id} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-ui border border-line p-2">
                  <TextField label="Field name" value={f.name} onChange={(e) => onEdit(updateCustomField(config, f.id, { name: e.target.value }))} />
                  <Button variant="ghost" aria-label={`Remove field ${f.name}`} onClick={() => onEdit(removeCustomField(config, f.id))}><Trash2 className="h-4 w-4" /></Button>
                  <SelectField label="Type" value={f.type} onChange={(e) => onEdit(updateCustomField(config, f.id, { type: e.target.value as (typeof fieldTypes)[number] }))}>
                    {fieldTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </SelectField>
                  <label className="flex h-9 items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={f.required} onChange={(e) => onEdit(updateCustomField(config, f.id, { required: e.target.checked }))} /> Required
                  </label>
                </div>
              ))}
              {config.customFields.every((f) => f.nodeId !== node.id) && <p className="text-xs text-muted">No custom fields on this module.</p>}
              <Button onClick={() => onEdit(addCustomField(config, node.id))}><Plus className="h-4 w-4" aria-hidden /> Add field</Button>
            </div>
          </Panel>

          {def.permissions.length > 0 && (
            <Panel title="Role access">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Permissions per role for {def.displayName}</caption>
                  <thead>
                    <tr className="text-muted">
                      <th className="py-1 pr-2 font-medium">Role</th>
                      {def.permissions.map((p) => <th key={p} className="px-1 py-1 text-center font-medium" title={p}>{labelFor(p)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {config.roles.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <th scope="row" className="py-1.5 pr-2 font-medium">{r.name}</th>
                        {def.permissions.map((p) => (
                          <td key={p} className="px-1 py-1.5 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${r.name} ${labelFor(p)} (${p})`}
                              checked={r.permissions.includes(p)}
                              onChange={(e) => onEdit(setRolePermission(config, r.id, p, e.target.checked))}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">Columns are this module&apos;s real permissions. Hover a heading to see its key.</p>
            </Panel>
          )}
        </>
      )}

      {!settingsOnly && (
      <Panel title="Formula builder" actions={<Badge tone="info">site-wide</Badge>}>
        <div className="flex flex-col gap-3">
          {config.calculatedFieldDefinitions.map((f) => (
            <div key={f.id} className="flex flex-col gap-2 rounded-ui border border-line p-2">
              <div className="flex items-end gap-2">
                <TextField className="flex-1" label="Label" value={f.label} onChange={(e) => onEdit(updateCalculatedField(config, f.id, { label: e.target.value }))} />
                <Button variant="ghost" aria-label={`Remove ${f.label}`} onClick={() => onEdit(removeCalculatedField(config, f.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <TextField label="Expression" value={f.expression} className="font-mono" spellCheck={false} hint="Numbers, + - * /, ( ), field names, round(), min(), max(). Checked by the server compiler; never executed as code." onChange={(e) => onEdit(updateCalculatedField(config, f.id, { expression: e.target.value }))} />
              <TextField
                label="Inputs (name:type, comma separated)"
                key={`${f.id}:${JSON.stringify(f.inputs)}`}
                defaultValue={Object.entries(f.inputs).map(([k, v]) => `${k}:${v}`).join(", ")}
                onBlur={(e) => {
                  const inputs: Record<string, "number" | "string" | "boolean"> = {};
                  for (const part of e.target.value.split(",")) {
                    const [name, type] = part.split(":").map((x) => x.trim());
                    if (name) inputs[name] = (calcTypes as readonly string[]).includes(type ?? "") ? (type as "number") : "number";
                  }
                  onEdit(updateCalculatedField(config, f.id, { inputs }));
                }}
              />
              <SelectField label="Result type" value={f.resultType} onChange={(e) => onEdit(updateCalculatedField(config, f.id, { resultType: e.target.value as (typeof calcTypes)[number] }))}>
                {calcTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </SelectField>
            </div>
          ))}
          {config.calculatedFieldDefinitions.length === 0 && <p className="text-xs text-muted">No calculated fields yet.</p>}
          <Button onClick={() => onEdit(addCalculatedField(config))}><Plus className="h-4 w-4" aria-hidden /> Add calculated field</Button>
        </div>
      </Panel>
      )}
    </div>
  );
}
