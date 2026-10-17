import { CheckCircle2, CircleDashed, Loader2, Rocket, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { siteSlugSchema, type SiteConfiguration, type WebsiteTheme } from "@opshub/contracts";
import { useAsync } from "../../../hooks/useAsync";
import { toRequestError } from "../../../lib/api";
import { websiteApi } from "../../../services";
import { useCanBuildWebsites, useSession } from "../../../stores/session";
import { useProvisioningLog } from "../../provisioning/useProvisioningLog";
import { AccessControl, toAccess, type AccessValue } from "./AccessControl";
import { DeploySuccessDialog } from "./DeploySuccessDialog";
import { slugFromName, THEME_EMOJI, WEBSITE_THEMES } from "./themes";
import { WebsitePreview } from "./WebsitePreview";

/** Steps the provisioning log reports for a website deploy; drives the progress bar. */
const EXPECTED_EVENTS = 15;

const field = "h-10 w-full rounded-xl border-2 border-[#1E293B] bg-white px-3 text-sm font-medium text-[#0F172A] placeholder:text-[#94A3B8] shadow-[2px_2px_0px_#1E293B] focus:border-[#4285F4] focus:outline-none focus:ring-2 focus:ring-[#4285F4]/30 aria-[invalid=true]:border-[#EA4335]";

/** Identity is assigned by the server; strip the builder's placeholders before sending. */
function deployable(config: SiteConfiguration): Record<string, unknown> {
  const { siteId: _s, slug: _g, name: _n, ...rest } = config;
  return rest;
}

/** Platform administrators only; renders nothing for anyone else. */
export function WebsiteDeployPanel(props: DeployPanelProps) {
  return useCanBuildWebsites() ? <DeployPanel {...props} /> : null;
}

interface DeployPanelProps { templateId: string; templateName: string; theme: WebsiteTheme; onTheme: (t: WebsiteTheme) => void; config: SiteConfiguration; onDeployed: () => void }

function DeployPanel({ templateId, templateName, theme, onTheme, config, onDeployed }: DeployPanelProps) {
  const session = useSession((s) => s.session);
  const restore = useSession((s) => s.restore);
  const users = useAsync(() => websiteApi.users(), []);
  const roles = useMemo(() => config.roles.filter((r) => r.id !== "admin").map((r) => ({ id: r.id, name: r.name })), [config.roles]);
  const defaultRole = roles.find((r) => r.id === "viewer")?.id ?? roles[0]?.id ?? "";

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [access, setAccess] = useState<AccessValue>({ mode: "selected", roleId: defaultRole, userIds: [] });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; path: string; name: string } | null>(null);
  const [done, setDone] = useState<{ path: string; name: string } | null>(null);

  // A different template may define different roles.
  useEffect(() => {
    if (!roles.some((r) => r.id === access.roleId)) setAccess((a) => ({ ...a, roleId: defaultRole }));
  }, [roles, access.roleId, defaultRole]);

  const finished = (ok: boolean, message: string | null) => {
    if (!job) return;
    if (ok) {
      void restore();
      setDone({ path: job.path, name: job.name });
      onDeployed();
    } else {
      setError(message ?? "Deploy failed. Nothing was created.");
    }
    setJob(null);
  };

  const slugCheck = siteSlugSchema.safeParse(slug);
  const nameError = touched && name.trim().length < 2 ? "Enter a website name" : undefined;
  const slugError = touched && !slugCheck.success ? (slugCheck.error.issues[0]?.message ?? "Invalid address") : undefined;
  const me = new Set(session ? [session.user.id] : []);
  const running = Boolean(job) || busy;

  const deploy = async () => {
    setTouched(true);
    setError(null);
    if (name.trim().length < 2 || !slugCheck.success || !access.roleId) return;
    setBusy(true);
    try {
      const r = await websiteApi.deploy({ name: name.trim(), slug, templateId, theme, configuration: deployable(config), access: toAccess(access) });
      setJob({ jobId: r.jobId, path: r.path, name: name.trim() });
    } catch (e) {
      setError(toRequestError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDone(null);
    setName("");
    setSlug("");
    setSlugEdited(false);
    setTouched(false);
  };

  const pages = config.navigation.map((n) => n.label);

  return (
    <section aria-label="Deploy website" className="overflow-hidden rounded-2xl border-2 border-[#1E293B] bg-white text-[#0F172A] shadow-[4px_4px_0px_#1E293B]">
      <header className="flex items-center justify-between gap-2 border-b-2 border-[#1E293B] bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-['Outfit',sans-serif] uppercase tracking-wider text-base font-extrabold text-[#0F172A]">Deploy website</h2>
          <p className="truncate text-[11px] font-medium text-slate-500">From {templateName}</p>
        </div>
        <span className="rounded-full border border-[#1E293B] bg-[#FBBC04] px-2.5 py-0.5 text-[10px] font-bold text-[#0F172A] shadow-[1px_1px_0px_#1E293B]">{config.modules.nodes.length} modules</span>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">Website name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(slugFromName(e.target.value));
              }}
              placeholder="e.g. Flipkart Stores"
              aria-invalid={nameError ? true : undefined}
              className={field}
              maxLength={80}
            />
            {nameError && <span role="alert" className="text-[11px] font-bold text-[#EA4335]">{nameError}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">URL slug</span>
            <span className="flex items-center overflow-hidden rounded-xl border-2 border-[#1E293B] bg-white shadow-[2px_2px_0px_#1E293B] focus-within:border-[#4285F4] focus-within:ring-2 focus-within:ring-[#4285F4]/30">
              <span className="shrink-0 pl-3 font-mono text-xs font-bold text-slate-500">/w/</span>
              <input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase());
                  setSlugEdited(true);
                }}
                placeholder="my-site"
                aria-label="URL slug"
                aria-invalid={slugError ? true : undefined}
                className="h-10 min-w-0 flex-1 bg-transparent px-2 font-mono text-sm font-bold text-[#0F172A] placeholder:text-slate-400 focus:outline-none"
              />
            </span>
            {slugError && <span role="alert" className="text-[11px] font-bold text-[#EA4335]">{slugError}</span>}
          </label>
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">Theme</p>
          <div role="radiogroup" aria-label="Website theme" className="grid grid-cols-3 gap-1.5">
            {WEBSITE_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === theme.id}
                onClick={() => onTheme(t)}
                className={`flex items-center gap-1.5 rounded-xl border-2 px-2 py-1.5 text-left text-[11px] font-bold transition-all ${
                  t.id === theme.id
                    ? "border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[2px_2px_0px_#1E293B]"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#1E293B] hover:bg-white"
                }`}
              >
                <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#1E293B]" style={{ background: t.palette.primary }} />
                <span className="truncate">{t.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-2.5 rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2 shadow-[2px_2px_0px_#1E293B]">
            <WebsitePreview theme={theme} siteName={name || templateName} pages={pages.length ? pages : undefined} />
            <p className="mt-1.5 px-0.5 text-[10px] font-medium text-slate-600">
              {THEME_EMOJI[theme.id]} {theme.name} · {theme.shell} · {theme.fontFamily} · {theme.cardStyle} cards · {theme.navPosition} nav
            </p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">Access control</p>
          {users.loading ? (
            <p className="flex items-center gap-2 text-xs text-slate-500 font-bold"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading people…</p>
          ) : users.error ? (
            <p role="alert" className="text-xs font-bold text-[#EA4335]">{toRequestError(users.error).message}</p>
          ) : (
            <AccessControl value={access} onChange={setAccess} users={users.data ?? []} roles={roles} alwaysIds={me} />
          )}
        </div>

        {error && <p role="alert" className="rounded-xl border-2 border-[#EA4335] bg-[#FFF1F2] p-2.5 text-xs font-bold text-[#EA4335] shadow-[2px_2px_0px_#EA4335]">{error}</p>}

        {job && <DeployProgress key={job.jobId} jobId={job.jobId} onFinished={finished} />}

        <button
          type="button"
          onClick={() => void deploy()}
          disabled={running}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-[#1E293B] bg-[#FBBC04] font-mono text-xs font-black uppercase tracking-wider text-[#0F172A] shadow-[3px_3px_0px_#1E293B] transition-all hover:bg-[#F59E0B] active:translate-x-[1px] active:translate-y-[1px] disabled:cursor-wait disabled:opacity-70"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Rocket className="h-4 w-4" aria-hidden />}
          {running ? "Deploying…" : "Deploy"}
        </button>
      </div>

      {done && <DeploySuccessDialog name={done.name} path={done.path} onClose={() => setDone(null)} onDeployAnother={reset} />}
    </section>
  );
}

/** Follows one deploy job. Mounted per job, so a previous job's final state can never leak in. */
function DeployProgress({ jobId, onFinished }: { jobId: string; onFinished: (ok: boolean, error: string | null) => void }) {
  const log = useProvisioningLog(jobId);
  const report = useRef(onFinished);
  report.current = onFinished;
  useEffect(() => {
    if (log.status !== "running") report.current(log.status === "succeeded", log.error);
  }, [log.status, log.error]);

  const pct = Math.min(95, Math.round((log.events.length / EXPECTED_EVENTS) * 100));
  return (
    <div aria-live="polite" className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-3 shadow-[2px_2px_0px_#1E293B]">
      <div className="h-2 overflow-hidden rounded-full border border-[#1E293B] bg-slate-200">
        <div className="h-full rounded-full bg-[#FBBC04] transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <ol aria-label="Deploy log" className="mt-2.5 flex flex-col gap-1">
        {log.events.slice(-4).map((e) => {
          const Icon = e.level === "success" ? CheckCircle2 : e.level === "error" ? XCircle : CircleDashed;
          return (
            <li key={e.seq} className="ws-fade-up flex items-start gap-1.5 text-[11px] font-medium text-slate-700">
              <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${e.level === "success" ? "text-[#34A853]" : e.level === "error" ? "text-[#EA4335]" : "text-slate-400"}`} aria-hidden />
              <span>{e.message}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
