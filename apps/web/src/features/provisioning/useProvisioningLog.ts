import { useEffect, useState } from "react";
import type { ProvisioningEvent, ProvisioningStatus } from "@opshub/contracts";
import { provisioningApi } from "../../services";

export interface ProvisioningLogState {
  events: ProvisioningEvent[];
  status: ProvisioningStatus;
  error: string | null;
  /** "stream" while Server-Sent Events work, "polling" after falling back. */
  transport: "stream" | "polling";
}

/**
 * Follows a provisioning job. Uses Server-Sent Events for a live log; if the stream cannot be used
 * (unsupported, proxy buffering, expired session) it falls back to polling the same data.
 */
export function useProvisioningLog(jobId: string | null, attempt = 0): ProvisioningLogState {
  const [state, setState] = useState<ProvisioningLogState>({ events: [], status: "running", error: null, transport: "stream" });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSeq = 0;
    setState({ events: [], status: "running", error: null, transport: "stream" });

    const add = (e: ProvisioningEvent) => {
      if (e.seq <= lastSeq) return;
      lastSeq = e.seq;
      setState((s) => ({ ...s, events: [...s.events, e] }));
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const snap = await provisioningApi.snapshot(jobId, lastSeq);
        if (cancelled) return;
        snap.events.forEach(add);
        setState((s) => ({ ...s, transport: "polling", status: snap.job.status, error: snap.job.error }));
        if (snap.job.status === "running") timer = setTimeout(() => void poll(), 700);
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, transport: "polling", error: e instanceof Error ? e.message : "Lost contact with the server", status: "failed" }));
      }
    };

    if (typeof EventSource === "undefined") {
      void poll();
    } else {
      source = new EventSource(`/api/v1/provisioning/${jobId}/events`, { withCredentials: true });
      source.addEventListener("log", (m) => add(JSON.parse((m as MessageEvent<string>).data) as ProvisioningEvent));
      source.addEventListener("done", (m) => {
        const job = JSON.parse((m as MessageEvent<string>).data) as { status: ProvisioningStatus; error: string | null };
        setState((s) => ({ ...s, status: job.status, error: job.error }));
        source?.close();
      });
      source.onerror = () => {
        // The stream ended without "done": switch to polling, which also refreshes an expired session.
        source?.close();
        void poll();
      };
    }

    return () => {
      cancelled = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [jobId, attempt]);

  return state;
}
