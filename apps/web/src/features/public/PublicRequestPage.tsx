import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { publicRequestSchema } from "@opshub/contracts";
import { Button, TextField } from "../../components/ui";

interface Line {
  sku: string;
  quantity: string;
}

type Outcome = { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string };

/**
 * Signed-out request form for sites that have turned on public intake. It reveals nothing about the site, its stock
 * or the request: it only says whether the submission was received.
 */
export function PublicRequestPage() {
  const { slug = "" } = useParams();
  const [lines, setLines] = useState<Line[]>([{ sku: "", quantity: "1" }]);
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, hidden from people
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = publicRequestSchema.safeParse({
      lines: lines.map((l) => ({ sku: l.sku.trim(), quantity: Number(l.quantity) })),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(website ? { website } : {}),
    });
    if (!parsed.success) return setOutcome({ kind: "error", message: parsed.error.issues[0]?.message ?? "Check the form and try again." });
    setBusy(true);
    try {
      const res = await fetch(`/api/public/${encodeURIComponent(slug)}/requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (res.status === 202) {
        setOutcome({ kind: "sent" });
        return;
      }
      const message =
        res.status === 404 ? "This form is not available." : res.status === 429 ? "Too many submissions. Please wait a minute and try again." : ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "The request could not be sent.";
      setOutcome({ kind: "error", message });
    } catch {
      setOutcome({ kind: "error", message: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  if (outcome.kind === "sent") {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold">Request received</h1>
        <p className="mt-2 text-sm text-muted">Thank you. Your request has been sent for approval. You will not see a confirmation number here.</p>
        <div className="mt-4"><Button onClick={() => { setLines([{ sku: "", quantity: "1" }]); setNote(""); setOutcome({ kind: "idle" }); }}>Send another</Button></div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold">Request items</h1>
      <p className="mb-4 mt-0.5 text-sm text-muted">No account needed. Enter the item codes you were given. Requests are reviewed before anything is issued.</p>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><TextField label={`Item code ${i + 1}`} value={l.sku} onChange={(e) => set(i, { sku: e.target.value })} maxLength={64} autoComplete="off" /></div>
            <div className="w-24"><TextField label="Quantity" type="number" min={1} max={100} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></div>
            {lines.length > 1 && <Button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>Remove</Button>}
          </div>
        ))}
        {lines.length < 5 && <div><Button type="button" onClick={() => setLines((ls) => [...ls, { sku: "", quantity: "1" }])}>Add another item</Button></div>}
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        {/* Honeypot: invisible to people and to assistive technology; bots tend to fill it. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        </div>
        {outcome.kind === "error" && <p role="alert" className="text-sm text-red-700">{outcome.message}</p>}
        <div><Button type="submit" variant="primary" loading={busy}>Send request</Button></div>
      </form>
    </main>
  );
}
