import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReleaseSummary } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Badge, Button, PageHeader, Panel } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { toRequestError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useSiteRuntime } from "../../runtime/context";
import { releasesApi } from "../../services";
import { notify } from "../../stores/toast";
import { usePreviewStore } from "../builder/previewStore";
import { ImpactDialog } from "./ImpactDialog";

const describe = (r: ReleaseSummary) =>
  `Version ${r.version}${r.isActive ? " (active)" : ""}, published ${formatDateTime(r.publishedAt)}${r.publishedByName ? ` by ${r.publishedByName}` : ""}`;

/** Drag through the release history; each stop explains itself in plain English and can be previewed or rolled back to. */
export function RewindPage() {
  const { siteId, slug, reload } = useSiteRuntime();
  const navigate = useNavigate();
  const setPreview = usePreviewStore((s) => s.setDraft);
  const releases = useAsync(() => releasesApi.list(siteId), [siteId]);
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Oldest first, so dragging right moves forward in time.
  const timeline = useMemo(() => [...(releases.data ?? [])].sort((a, b) => a.version - b.version), [releases.data]);
  const active = timeline.find((r) => r.isActive);
  const index = picked ?? Math.max(0, timeline.findIndex((r) => r.isActive));
  const selected = timeline[index];
  const isCurrent = selected?.isActive ?? true;

  const meaning = useAsync(
    async () => (selected ? releasesApi.summary(siteId, selected.id) : null),
    [siteId, selected?.id],
  );
  const effect = useAsync(
    async () => (selected && active && !selected.isActive ? releasesApi.impact(siteId, { baseVersion: active.version, targetVersion: selected.version }) : null),
    [siteId, selected?.id, active?.id],
  );

  const preview = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { configuration } = await releasesApi.get(siteId, selected.id);
      setPreview(slug, configuration);
      navigate(`/preview/${slug}`);
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (confirmDestructive: boolean) => {
    if (!selected || !active) return;
    setBusy(true);
    try {
      const created = await releasesApi.rollback(siteId, { targetVersion: selected.version, baseVersion: active.version, ...(confirmDestructive ? { confirmDestructive: true } : {}) });
      notify.success(`Rolled back to v${selected.version} as new release v${created.version}`);
      setConfirming(false);
      setPicked(null);
      releases.reload();
      reload();
    } catch (e) {
      notify.error(toRequestError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Rewind" subtitle="Move through this site's release history. Nothing changes until you roll back, and history is never deleted." />
      {releases.loading && !releases.data && <LoadingState />}
      {releases.error ? <ErrorState error={releases.error} onRetry={releases.reload} /> : null}
      {timeline.length > 0 && selected && (
        <div className="flex flex-col gap-4">
          <Panel title="Timeline">
            <label htmlFor="rewind-slider" className="sr-only">Release version</label>
            <input
              id="rewind-slider"
              type="range"
              min={0}
              max={timeline.length - 1}
              step={1}
              value={index}
              onChange={(e) => setPicked(Number(e.target.value))}
              aria-valuetext={describe(selected)}
              className="w-full accent-[var(--accent,theme(colors.indigo.600))]"
            />
            <ol className="mt-1 flex justify-between text-xs text-muted" aria-hidden>
              {timeline.map((r, i) => (
                <li key={r.id} className={i === index ? "font-semibold text-ink" : ""}>
                  v{r.version}{r.isActive ? " ●" : ""}
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">v{selected.version}</span>
              {selected.isActive && <Badge tone="success">Active now</Badge>}
              {selected.rolledBackToVersion && <Badge tone="info">Rollback of v{selected.rolledBackToVersion}</Badge>}
              <span className="text-muted">{formatDateTime(selected.publishedAt)}{selected.publishedByName ? ` · ${selected.publishedByName}` : ""}</span>
              {selected.note && <span className="text-muted">· “{selected.note}”</span>}
            </div>
          </Panel>

          <Panel title={`What version ${selected.version} changed`}>
            {meaning.loading && !meaning.data && <LoadingState />}
            {meaning.error ? <ErrorState error={meaning.error} onRetry={meaning.reload} /> : null}
            {meaning.data && (
              <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="What this version changed">
                {meaning.data.sentences.map((s) => <li key={s}>{s}</li>)}
              </ul>
            )}
          </Panel>

          {!isCurrent && (
            <Panel title={`If you go back to version ${selected.version}`}>
              {effect.loading && !effect.data && <LoadingState />}
              {effect.error ? <ErrorState error={effect.error} onRetry={effect.reload} /> : null}
              {effect.data && (
                <>
                  <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="What rolling back would do">
                    {effect.data.sentences.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                  {effect.data.impact?.destructive && <p className="mt-2 text-xs"><Badge tone="warning">Needs confirmation</Badge> This affects things that are in use; you will be asked to confirm.</p>}
                </>
              )}
            </Panel>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void preview()} loading={busy} aria-label={`Preview version ${selected.version}`}>Preview this version</Button>
            <Button variant="primary" disabled={isCurrent} onClick={() => setConfirming(true)}>Roll back to v{selected.version}</Button>
            {isCurrent && <span className="self-center text-xs text-muted">This is the active version.</span>}
          </div>
        </div>
      )}
      {confirming && selected && active && (
        <ImpactDialog
          siteId={siteId}
          title={`Roll back to v${selected.version}?`}
          confirmLabel="Roll back"
          busy={busy}
          request={{ baseVersion: active.version, targetVersion: selected.version }}
          onConfirm={(c) => void rollback(c)}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
