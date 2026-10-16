import { useRef, useState } from "react";
import { adjustStockPayloadSchema } from "@opshub/contracts";
import { Button, TextField } from "../../components/ui";
import { toRequestError } from "../../lib/api";
import { stockApi } from "../../services";
import { notify } from "../../stores/toast";

/**
 * Manual stock correction (found stock, damage, miscount). Every change needs a reason, writes one ledger entry, and
 * carries an idempotency key that survives retries of the same click, so a flaky connection cannot apply it twice.
 */
export function AdjustStock({ siteId, itemId, onDone }: { siteId: string; itemId: string; onDone: () => void }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  const submit = async () => {
    const parsed = adjustStockPayloadSchema.safeParse({ delta: Number(delta), reason });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the values");
    setError(null);
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const out = await stockApi.adjust(siteId, itemId, parsed.data, key.current);
      key.current = null;
      notify.success(`Stock is now ${out.onHand}`);
      setDelta("");
      setReason("");
      onDone();
    } catch (e) {
      const err = toRequestError(e);
      if (err.status !== 0) key.current = null; // a definite answer: the next attempt is a new change
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-4 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate aria-label="Adjust stock">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Adjust stock</h3>
      <TextField label="Change (+ adds, − removes)" type="number" step={1} value={delta} onChange={(e) => setDelta(e.target.value)} />
      <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div><Button type="submit" loading={busy} disabled={delta === "" || reason.trim().length < 3}>Apply adjustment</Button></div>
    </form>
  );
}
