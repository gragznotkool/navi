import { useEffect, useState } from "react";
import { dismiss, listOutbox, retry } from "../lib/offline/engine";
import type { OutboxItem, OutboxType } from "../lib/offline/store";
import { useOffline } from "../stores/offline";
import { Badge, Button } from "./ui";

/** Changes saved on this device for one site: waiting to be sent, or refused by the server (kept visible until dismissed). */
export function PendingOps({ siteId, types }: { siteId: string; types: OutboxType[] }) {
  const { pending, rejected } = useOffline();
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    let live = true;
    void listOutbox(siteId).then((all) => live && setItems(all.filter((i) => types.includes(i.type))));
    return () => {
      live = false;
    };
    // The counts change whenever the queue does, which is the signal to re-read it.
  }, [siteId, pending, rejected, types.join(",")]);

  if (items.length === 0) return null;
  return (
    <section aria-label="Saved on this device" className="mb-4 rounded-ui border border-line bg-surface p-3">
      <h2 className="mb-2 text-sm font-semibold">Saved on this device</h2>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
            {i.state === "pending" ? <Badge tone="info">Waiting to send</Badge> : <Badge tone="danger">Not accepted</Badge>}
            <span>{i.label}</span>
            {i.state === "rejected" && <span className="text-xs text-red-700">{i.reason ?? "The server did not accept this."}</span>}
            {i.state === "rejected" && (
              <span className="ml-auto flex gap-2">
                <Button onClick={() => void retry(i.id)} aria-label={`Try sending again: ${i.label}`}>Try again</Button>
                <Button onClick={() => void dismiss(i.id)} aria-label={`Dismiss: ${i.label}`}>Dismiss</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
