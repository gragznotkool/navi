import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import type { z } from "zod";
import { provisionSiteRequestSchema, type ProvisionSiteRequest, type ProvisioningEvent } from "@opshub/contracts";
import { EmptyState, ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, Panel, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { provisioningApi } from "../../services";
import { useSession } from "../../stores/session";
import { useProvisioningLog } from "./useProvisioningLog";

type FormInput = z.input<typeof provisionSiteRequestSchema>;

const slugFromName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function NewSitePage() {
  const session = useSession((s) => s.session);
  const [started, setStarted] = useState<{ jobId: string; request: ProvisionSiteRequest } | null>(null);

  if (!session?.user.isPlatformAdmin) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <EmptyState title="Platform administrators only" hint="Creating a site needs a platform administrator account." action={<Link className="mt-2 text-sm text-accent underline" to="/">Back to your sites</Link>} />
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link to="/" className="text-xs text-muted hover:underline">← Sites</Link>
      <h1 className="mt-1 text-lg font-semibold">Create a new site</h1>
      <p className="mb-4 mt-0.5 text-sm text-muted">One save creates the site, its first release, access and (optionally) demo stock. If any step fails, nothing is kept.</p>
      {started ? <ProgressView job={started} onRestart={() => setStarted(null)} /> : <CreateForm onStarted={(jobId, request) => setStarted({ jobId, request })} />}
    </main>
  );
}

function CreateForm({ onStarted }: { onStarted: (jobId: string, request: ProvisionSiteRequest) => void }) {
  const presets = useAsync(() => provisioningApi.presets(), []);
  const [slugEdited, setSlugEdited] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, ProvisionSiteRequest>({
    resolver: zodResolver(provisionSiteRequestSchema),
    defaultValues: { name: "", slug: "", preset: "", adminEmail: "", demoStock: false },
  });
  const { errors, isSubmitting } = form.formState;
  const chosen = form.watch("preset");

  useEffect(() => {
    if (!form.getValues("preset") && presets.data?.[0]) form.setValue("preset", presets.data[0].id);
  }, [presets.data, form]);

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const job = await provisioningApi.start(values);
      onStarted(job.id, values);
    } catch (e) {
      setServerError(toRequestError(e).message);
    }
  });

  const nameField = form.register("name");
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="New site">
      <Panel title="Site">
        <div className="flex flex-col gap-3">
          <TextField
            label="Site name"
            error={errors.name?.message}
            {...nameField}
            onChange={(e) => {
              void nameField.onChange(e);
              if (!slugEdited) form.setValue("slug", slugFromName(e.target.value), { shouldValidate: form.formState.isSubmitted });
            }}
          />
          <TextField
            label="Address (slug)"
            hint="Used in the URL: /s/your-address"
            error={errors.slug?.message}
            {...form.register("slug", { onChange: () => setSlugEdited(true) })}
          />
          <TextField label="Additional administrator (optional)" type="email" hint="Must already have an account. You are added automatically." error={errors.adminEmail?.message} {...form.register("adminEmail")} />
        </div>
      </Panel>
      <Panel title="Preset">
        {presets.loading && <LoadingState />}
        {presets.error ? <ErrorState error={presets.error} onRetry={presets.reload} /> : null}
        {presets.data && (
          <fieldset className="grid gap-2 sm:grid-cols-3">
            <legend className="sr-only">Choose a preset</legend>
            {presets.data.map((p) => (
              <label key={p.id} className={`flex cursor-pointer flex-col gap-1 rounded-ui border p-3 text-sm ${chosen === p.id ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
                <span className="flex items-center gap-2">
                  <input type="radio" value={p.id} {...form.register("preset")} />
                  <span className="font-medium">{p.label}</span>
                </span>
                <span className="text-xs text-muted">{p.description}</span>
                <span className="text-xs text-muted">{p.shell} shell · {p.modules.join(", ")}</span>
              </label>
            ))}
          </fieldset>
        )}
        {errors.preset?.message && <p role="alert" className="mt-2 text-xs text-danger">{errors.preset.message}</p>}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register("demoStock")} /> Add demo stock (three items with opening balances)
        </label>
      </Panel>
      {serverError && <p role="alert" className="rounded-ui border border-danger/40 bg-danger/10 p-2.5 text-sm text-danger">{serverError}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={isSubmitting}>Create site</Button>
      </div>
    </form>
  );
}

const icon = { info: CircleDashed, success: CheckCircle2, error: XCircle } as const;
const iconTone = { info: "text-muted", success: "text-success", error: "text-danger" } as const;

function LogLine({ e }: { e: ProvisioningEvent }) {
  const Icon = icon[e.level];
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm font-mono text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconTone[e.level]}`} aria-hidden />
      <span className="sr-only">{e.level}: </span>
      <span className={e.level === "error" ? "text-danger" : "text-secondary"}>{e.message}</span>
    </li>
  );
}

function ProgressView({ job, onRestart }: { job: { jobId: string; request: ProvisionSiteRequest }; onRestart: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const view = useProvisioningLog(job.jobId, attempt);
  const restore = useSession((s) => s.restore);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Refresh the session so the new site is a known membership (the site page reads it).
  useEffect(() => {
    if (view.status === "succeeded") void restore();
  }, [view.status, restore]);

  // A retry reuses the same job (the log keeps its history), so just follow it again.
  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await provisioningApi.start(job.request);
      setAttempt((a) => a + 1);
    } catch (e) {
      setRetryError(toRequestError(e).message);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Panel
      title={`CREATING “${job.request.name.toUpperCase()}”`}
      actions={<Badge tone={view.status === "succeeded" ? "success" : view.status === "failed" ? "danger" : "yellow"}>{view.status === "running" ? "RUNNING" : view.status === "succeeded" ? "DONE" : "FAILED"}</Badge>}
    >
      <ol aria-label="Provisioning log" aria-live="polite" className="divide-y divide-border rounded border border-border bg-[#111313] p-3 font-mono">
        {view.events.map((e) => <LogLine key={e.seq} e={e} />)}
      </ol>
      {view.status === "running" && view.events.length === 0 && <LoadingState label="Starting…" />}
      {view.transport === "polling" && view.status === "running" && <p className="mt-2 text-xs text-muted font-mono">Live stream unavailable; updating every second.</p>}
      {view.status === "succeeded" && (
        <div className="mt-4 flex items-center justify-between rounded-ui border border-border bg-surface p-3">
          <p className="text-sm font-medium text-primary">“{job.request.name}” is ready.</p>
          <div className="flex gap-2">
            <Link to="/" className="inline-flex h-9 items-center rounded-[2px] border border-border bg-[#111313] px-3 font-mono text-xs font-semibold uppercase tracking-wider text-primary hover:bg-[#1f2321]">Back to hub</Link>
            <Link to={`/s/${job.request.slug}`} className="inline-flex h-9 items-center rounded-[2px] bg-[#FFE500] px-3 font-mono text-xs font-semibold uppercase tracking-wider text-black shadow-sm hover:bg-[#E8D000]">Open site</Link>
          </div>
        </div>
      )}
      {view.status === "failed" && (
        <div role="alert" className="mt-4 rounded-ui border border-danger/40 bg-danger/10 p-3 text-sm">
          <p className="font-medium text-danger">{view.error ?? "Provisioning failed."}</p>
          {retryError && <p className="mt-1 text-danger">{retryError}</p>}
          <div className="mt-3 flex gap-2">
            <Button onClick={onRestart}>Edit details</Button>
            <Button variant="primary" loading={retrying} onClick={() => void retry()}>Try again</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
