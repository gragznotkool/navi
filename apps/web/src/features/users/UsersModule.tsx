import { useState } from "react";
import type { SiteMember } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { DataTable } from "../../components/tables/DataTable";
import { Button, PageHeader, Panel, SelectField, TextField } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { useSiteRuntime } from "../../runtime/context";
import type { ModuleProps } from "../../runtime/registry";
import { membersApi } from "../../services";
import { useSession } from "../../stores/session";
import { notify } from "../../stores/toast";

/** Who can use this site and with which roles. Roles come from the site's published configuration. */
export function UsersModule({ page }: ModuleProps) {
  const { siteId, config, permissions } = useSiteRuntime();
  const me = useSession((s) => s.session?.user.id);
  const canManage = permissions.has("users:manage");
  const members = useAsync(() => membersApi.list(siteId), [siteId]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(config.roles[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(key);
    try {
      await fn();
      notify.success(ok);
      members.reload();
      return true;
    } catch (e) {
      notify.error(toRequestError(e).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggle = (m: SiteMember, r: string) => {
    const roles = m.roles.includes(r) ? m.roles.filter((x) => x !== r) : [...m.roles, r];
    void run(m.userId + r, () => (roles.length === 0 ? membersApi.remove(siteId, m.userId) : membersApi.setRoles(siteId, m.userId, roles)), roles.length === 0 ? "Person removed from this site" : "Roles updated");
  };

  const add = async () => {
    if (await run("add", () => membersApi.add(siteId, { email, role }), "Person added")) setEmail("");
  };

  return (
    <>
      <PageHeader title={page.title} subtitle="People with access to this site. Changes take effect on their next request." />
      {canManage && (
        <div className="mb-4">
          <Panel title="Add a person">
            <form className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void add(); }} noValidate>
              <TextField label="Email of an existing account" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
                {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </SelectField>
              <Button type="submit" variant="primary" loading={busy === "add"} disabled={!email}>Add</Button>
            </form>
          </Panel>
        </div>
      )}
      {members.loading && !members.data && <LoadingState />}
      {members.error ? <ErrorState error={members.error} onRetry={members.reload} /> : null}
      {members.data && (
        <DataTable
          caption="Site members"
          rows={members.data}
          rowKey={(m) => m.userId}
          columns={[
            { key: "who", header: "Person", render: (m) => <span><span className="font-medium">{m.displayName}</span> <span className="text-xs text-muted">{m.email}</span></span> },
            {
              key: "roles",
              header: "Roles",
              render: (m) => (
                <div className="flex flex-wrap gap-3">
                  {config.roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={m.roles.includes(r.id)} disabled={!canManage || m.userId === me || busy !== null} onChange={() => toggle(m, r.id)} aria-label={`${r.name} for ${m.email}`} />
                      {r.name}
                    </label>
                  ))}
                </div>
              ),
            },
            { key: "note", header: "", render: (m) => (m.userId === me ? <span className="text-xs text-muted">You</span> : null) },
          ]}
        />
      )}
    </>
  );
}
