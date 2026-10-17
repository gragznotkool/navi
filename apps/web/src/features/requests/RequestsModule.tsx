import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { standardCreateRequestPayloadSchema, type StandardCreateRequestPayload, type RequestRecord } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { parseFieldValue, visibleFields } from "../../components/FieldInputs";
import { RecordView } from "../../components/tables/RecordView";
import { Button, PageHeader, Panel, SelectField, StatusBadge, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime, shortId, totalQuantity } from "../../lib/format";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { opsApi } from "../../services";
import { notify } from "../../stores/toast";

const STATUSES = ["submitted", "approved", "assigned", "fulfilled", "rejected"];

export function RequestsModule({ page, layout }: ModuleProps) {
  const { siteId, permissions } = useSiteRuntime();
  const requests = useAsync(() => opsApi.requests(siteId), [siteId]);
  const [creating, setCreating] = useState(false);
  const canCreate = permissions.has("request:create");

  return (
    <>
      <PageHeader
        title={page.title}
        subtitle="Requests raised against stock. Approval is required before material can be assigned."
        actions={canCreate && <Button variant="primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>New request</Button>}
      />
      {creating && (
        <div className="mb-4">
          <RequestForm
            siteId={siteId}
            onDone={() => {
              setCreating(false);
              requests.reload();
            }}
          />
        </div>
      )}
      {requests.loading && !requests.data && <LoadingState />}
      {requests.error ? <ErrorState error={requests.error} onRetry={requests.reload} /> : null}
      {requests.data && (
        <RecordView<RequestRecord>
          layout={layout}
          caption="Requests"
          rows={requests.data.items}
          rowKey={(r) => r.id}
          groupBy={(r) => r.status}
          groups={STATUSES}
          emptyTitle="No requests yet"
          emptyHint={canCreate ? "Use “New request” to raise the first one." : undefined}
          card={(r) => (
            <>
              <p className="text-sm font-medium">#{shortId(r.id)} · {r.lines.length} item(s), qty {totalQuantity(r)}</p>
              <p className="text-xs text-muted">{formatDateTime(r.createdAt)}</p>
            </>
          )}
          columns={[
            { key: "id", header: "Request", render: (r) => <span className="font-medium">#{shortId(r.id)}</span> },
            { key: "lines", header: "Items", align: "right", render: (r) => r.lines.length },
            { key: "qty", header: "Qty", align: "right", render: (r) => totalQuantity(r) },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "ver", header: "Config v", align: "right", render: (r) => r.releaseVersion },
            { key: "created", header: "Created", render: (r) => formatDateTime(r.createdAt) },
          ]}
          detail={(r) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Request</dt><dd>#{shortId(r.id)}</dd>
              <dt className="text-muted">Status</dt><dd><StatusBadge status={r.status} /></dd>
              <dt className="text-muted">Items</dt><dd><LineList lines={r.lines} /></dd>
              <dt className="text-muted">Created</dt><dd>{formatDateTime(r.createdAt)}</dd>
              <dt className="text-muted">Config version</dt><dd>{r.releaseVersion}</dd>
            </dl>
          )}
        />
      )}
    </>
  );
}

function LineList({ lines }: { lines: RequestRecord["lines"] }) {
  return (
    <ul>
      {lines.map((l) => (
        <li key={l.id}>{l.sku} — {l.name} × {l.quantity}</li>
      ))}
    </ul>
  );
}

function RequestForm({ siteId, onDone }: { siteId: string; onDone: () => void }) {
  const { config } = useSiteRuntime();
  const lineFields = visibleFields(config.fields, "request_line");
  const items = useAsync(() => opsApi.items(siteId), [siteId]);
  const form = useForm<StandardCreateRequestPayload>({
    resolver: zodResolver(standardCreateRequestPayloadSchema),
    defaultValues: { lines: [{ itemId: "", quantity: 1 }] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const { errors, isSubmitting } = form.formState;
  const itemOptions = items.data?.items ?? [];

  const submit = form.handleSubmit(async (values) => {
    try {
      await opsApi.createRequest(siteId, values);
      notify.success("Request submitted");
      onDone();
    } catch (e) {
      notify.error(toRequestError(e).message);
    }
  });

  return (
    <Panel title="New request">
      {items.loading && <LoadingState />}
      {items.error ? <ErrorState error={items.error} onRetry={items.reload} /> : null}
      {items.data && (
        <form onSubmit={submit} noValidate className="grid gap-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <SelectField label={`Item ${index + 1}`} error={errors.lines?.[index]?.itemId?.message && "Select an item"} {...form.register(`lines.${index}.itemId`)} defaultValue="">
                <option value="" disabled>Select an item…</option>
                {itemOptions.map((i) => (
                  <option key={i.id} value={i.id}>{i.sku} — {i.name} ({i.onHand} {i.unit})</option>
                ))}
              </SelectField>
              <TextField label="Quantity" type="number" min={1} error={errors.lines?.[index]?.quantity?.message} {...form.register(`lines.${index}.quantity`, { valueAsNumber: true })} />
              {fields.length > 1 ? <Button type="button" onClick={() => remove(index)} aria-label={`Remove item ${index + 1}`}>Remove</Button> : <span />}
              {lineFields.map((f) => (
                f.type === "boolean" ? (
                  <label key={f.id} className="flex items-center gap-2 text-sm sm:col-span-3">
                    <input type="checkbox" {...form.register(`lines.${index}.extras.${f.key}`)} /> {f.label}
                  </label>
                ) : (
                  <div key={f.id} className="sm:col-span-3">
                    <TextField
                      label={`${f.label}${f.required ? " *" : ""}`}
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      step={f.type === "number" ? "any" : undefined}
                      {...form.register(`lines.${index}.extras.${f.key}`, { setValueAs: (v) => parseFieldValue(f.type, v) })}
                    />
                  </div>
                )
              ))}
            </div>
          ))}
          {errors.lines?.root?.message || errors.lines?.message ? <p className="text-sm text-danger" role="alert">{errors.lines?.root?.message ?? errors.lines?.message}</p> : null}
          <div className="flex gap-2">
            <Button type="button" onClick={() => append({ itemId: "", quantity: 1 })}>Add another item</Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>Submit</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
