import { DatabaseBackup, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from "../../components/feedback";
import { Badge, Button, Panel } from "../../components/ui";
import { saveBlob, toRequestError } from "../../lib/api";
import { notify } from "../../stores/toast";
import { useAsync } from "../../hooks/useAsync";
import { hubApi, sitesApi } from "../../services";
import { useSession } from "../../stores/session";

function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { blob, fileName } = await hubApi.backup();
      saveBlob(blob, fileName);
      notify.success(`Backup downloaded: ${fileName} (${(blob.size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-6">
      <Panel title="Hub administration">
        <p className="mb-3 text-sm text-muted">Streams a live <code>pg_dump</code> (custom format) of the whole database. Restore it with <code>scripts/restore.sh</code>. Each download is audited.</p>
        <Button onClick={download} loading={busy}>
          {!busy && <DatabaseBackup className="h-4 w-4" aria-hidden />} Download Production Backup
        </Button>
      </Panel>
    </div>
  );
}

export function HubPage() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const sites = useAsync(() => sitesApi.list(), []);

  return (
    <div className="flex min-h-full flex-col">
      <OfflineBanner />
      <header className="flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <span className="text-sm font-semibold">OpsHub</span>
        <div className="flex items-center gap-3">
          {session?.user.isPlatformAdmin && (
            <Link to="/trust" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Trust console</Link>
          )}
          <span className="text-xs text-muted">{session?.user.displayName}</span>
          <button onClick={async () => { await logout(); navigate("/login"); }} className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"><LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out</button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-lg font-semibold">Your sites</h1>
        <p className="mb-4 mt-0.5 text-sm text-muted">Each site runs its own published configuration.</p>
        {sites.loading && <LoadingState />}
        {sites.error ? <ErrorState error={sites.error} onRetry={sites.reload} /> : null}
        {sites.data && sites.data.length === 0 && <EmptyState title="No sites assigned" hint="Ask a platform administrator to add you to a site." />}
        {sites.data && sites.data.length > 0 && (
          <ul className="divide-y divide-line rounded-ui border border-line bg-surface">
            {sites.data.map((s) => (
              <li key={s.id}>
                <Link to={`/s/${s.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span aria-hidden className="h-8 w-1 rounded" style={{ background: s.accent }} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{s.name}</span>
                    <span className="block text-xs text-muted">{s.slug} · {s.shell} shell</span>
                  </span>
                  <Badge>release v{s.activeReleaseVersion ?? "—"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {session?.user.isPlatformAdmin && <BackupPanel />}
      </main>
    </div>
  );
}
