import { Loader2, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { DeployedWebsite, PlatformUser, WebsiteAccess } from "@opshub/contracts";
import { ErrorState } from "../../../components/feedback";
import { useAsync } from "../../../hooks/useAsync";
import { toRequestError } from "../../../lib/api";
import { sitesApi, websiteApi } from "../../../services";
import { notify } from "../../../stores/toast";
import { Dialog } from "./Dialog";

export interface AccessValue {
  mode: "all" | "selected";
  roleId: string;
  userIds: string[];
}

export const toAccess = (v: AccessValue): WebsiteAccess => (v.mode === "all" ? { mode: "all", roleId: v.roleId } : { mode: "selected", roleId: v.roleId, userIds: v.userIds });

/** Picks who may open a website: everyone, or specific people. Administrators always have access. */
export function AccessControl({ value, onChange, users, roles, alwaysIds }: { value: AccessValue; onChange: (v: AccessValue) => void; users: readonly PlatformUser[]; roles: readonly { id: string; name: string }[]; alwaysIds: ReadonlySet<string> }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = users.filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const selected = new Set(value.userIds);
  const toggle = (id: string) => onChange({ ...value, userIds: selected.has(id) ? value.userIds.filter((x) => x !== id) : [...value.userIds, id] });
  const all = value.mode === "all";

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[3px] border border-[#303432] bg-[#111313] px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium text-[#F5F5F0]">All users</span>
          <span className="block text-[11px] text-[#A5A8A6]">Everyone with an OpsHub account today</span>
        </span>
        <span className="relative inline-flex">
          <input type="checkbox" role="switch" className="peer sr-only" checked={all} onChange={(e) => onChange({ ...value, mode: e.target.checked ? "all" : "selected" })} aria-label="All users" />
          <span className="h-5 w-9 rounded-full bg-[#303432] transition-colors peer-checked:bg-[#FFE500] peer-focus-visible:ring-2 peer-focus-visible:ring-[#FFE500]/40" />
          <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[#171919] shadow transition-transform peer-checked:translate-x-4" />
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#A5A8A6]">Visitor role</span>
        <select value={value.roleId} onChange={(e) => onChange({ ...value, roleId: e.target.value })} className="h-9 rounded-[3px] border border-[#303432] bg-[#171919] px-2.5 text-sm text-[#F5F5F0] focus:border-[#FFE500] focus:outline-none focus:ring-2 focus:ring-[#FFE500]/20">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>

      <div className={all ? "pointer-events-none opacity-50" : ""} aria-disabled={all}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A5A8A6]" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people…" aria-label="Search users" disabled={all} className="h-9 w-full rounded-[3px] border border-[#303432] bg-[#171919] pl-8 pr-2.5 text-sm text-[#F5F5F0] placeholder:text-[#777C79] focus:border-[#FFE500] focus:outline-none focus:ring-2 focus:ring-[#FFE500]/20" />
        </div>
        <ul className="mt-2 max-h-52 overflow-auto rounded-[3px] border border-[#303432] bg-[#171919]" aria-label="Users">
          {shown.map((u) => {
            const always = alwaysIds.has(u.id);
            return (
              <li key={u.id} className="border-b border-[#202422] last:border-b-0">
                <label className={`flex items-center gap-2.5 px-3 py-2 ${always ? "cursor-default" : "cursor-pointer hover:bg-[#1f2222]"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-[#FFE500]" checked={always || all || selected.has(u.id)} disabled={always || all} onChange={() => toggle(u.id)} aria-label={u.displayName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[#F5F5F0]">{u.displayName}</span>
                    <span className="block truncate text-[11px] text-[#A5A8A6]">{u.email}</span>
                  </span>
                  {always && <span className="inline-flex items-center gap-1 rounded-[3px] bg-[#FFE500]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#FFE500]"><ShieldCheck className="h-3 w-3" aria-hidden /> Admin</span>}
                </label>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-[#A5A8A6]">No people match.</li>}
        </ul>
        <p className="mt-1.5 text-[11px] text-[#A5A8A6]">{all ? "Everyone can open this website." : `${value.userIds.filter((id) => !alwaysIds.has(id)).length} selected · people without access see a 403.`}</p>
      </div>
    </div>
  );
}

/** Edit the visitors of an already deployed website. */
export function AccessDialog({ website, onClose, onSaved }: { website: DeployedWebsite; onClose: () => void; onSaved: () => void }) {
  const data = useAsync(async () => {
    const [users, entries, cfg] = await Promise.all([websiteApi.users(), websiteApi.access(website.id), sitesApi.config(website.id)]);
    return { users, entries, roles: cfg.configuration.roles.filter((r) => r.id !== "admin").map((r) => ({ id: r.id, name: r.name })) };
  }, [website.id]);
  const [value, setValue] = useState<AccessValue | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data.data || value) return;
    const visitors = data.data.entries.filter((e) => e.roles.some((r) => r !== "admin"));
    const roleId = visitors[0]?.roles.find((r) => r !== "admin") ?? data.data.roles[0]?.id ?? "";
    setValue({ mode: "selected", roleId, userIds: visitors.map((v) => v.userId) });
  }, [data.data, value]);

  const admins = new Set(data.data?.entries.filter((e) => e.roles.includes("admin")).map((e) => e.userId) ?? []);
  const save = async () => {
    if (!value) return;
    setSaving(true);
    try {
      await websiteApi.updateAccess(website.id, toAccess(value));
      notify.success(`Access updated for ${website.name}`);
      onSaved();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog label={`Access to ${website.name}`} onClose={onClose}>
      <div className="p-6">
        <h2 className="font-['Barlow_Condensed',sans-serif] uppercase tracking-wider text-lg font-bold">Who can open “{website.name}”?</h2>
        <p className="mb-4 mt-0.5 font-mono text-xs text-[#A5A8A6]">{website.path}</p>
        {data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}
        {!data.data || !value ? (
          <p className="flex items-center gap-2 py-6 text-sm text-[#A5A8A6]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading people…</p>
        ) : (
          <AccessControl value={value} onChange={setValue} users={data.data.users} roles={data.data.roles} alwaysIds={admins} />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-[3px] px-3.5 text-sm font-medium text-[#A5A8A6] hover:bg-[#1f2222]">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!value || saving} className="inline-flex h-9 items-center gap-2 rounded-[3px] bg-[#FFE500] px-4 text-sm font-semibold text-[#080909] hover:bg-[#E8D000] disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save access
          </button>
        </div>
      </div>
    </Dialog>
  );
}
