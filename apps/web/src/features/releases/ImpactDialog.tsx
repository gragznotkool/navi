import { useState } from "react";
import type { ImpactRequest } from "@opshub/contracts";
import { ErrorState, LoadingState } from "../../components/feedback";
import { Modal } from "../../components/ui/Modal";
import { Badge, Button } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";
import { releasesApi } from "../../services";

/**
 * Shows the plain-English impact of a publish or rollback. The confirm button stays disabled until the
 * server has produced the report, and destructive changes need an explicit checkbox.
 */
export function ImpactDialog({
  siteId,
  request,
  title,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  siteId: string;
  request: ImpactRequest;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (confirmDestructive: boolean) => void;
  onClose: () => void;
}) {
  const report = useAsync(() => releasesApi.impact(siteId, request), [siteId]);
  const [acknowledged, setAcknowledged] = useState(false);
  const data = report.data;
  const destructive = data?.impact?.destructive ?? false;
  const canConfirm = Boolean(data?.valid) && (!destructive || acknowledged);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={destructive ? "danger" : "primary"} disabled={!canConfirm} loading={busy} onClick={() => onConfirm(destructive)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {report.loading && <LoadingState label="Working out what will change…" />}
      {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : null}
      {data && !data.valid && (
        <div role="alert" className="text-sm">
          <p className="mb-1 font-medium text-danger">This configuration cannot be published:</p>
          <ul className="list-disc pl-5">
            {data.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}
      {data?.valid && (
        <>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">What will change</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Changes in plain English">
            {data.sentences.map((s) => <li key={s}>{s}</li>)}
          </ul>
          {destructive && data.impact && (
            <div className="mt-4 rounded-ui border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="mb-1 flex items-center gap-2 font-medium"><Badge tone="warning">Needs confirmation</Badge> This change affects things that are in use</p>
              <ul className="list-disc pl-5">
                {data.impact.destructiveReasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              <label className="mt-3 flex items-start gap-2">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1" />
                <span>I understand and want to continue. Hidden values stay in the database and can be restored.</span>
              </label>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
