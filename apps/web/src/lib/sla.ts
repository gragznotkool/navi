import type { SiteConfiguration } from "@opshub/contracts";

export type SlaTone = "ok" | "warning" | "breached";

export interface SlaState {
  tone: SlaTone;
  /** Seconds left before the deadline; negative once it has passed. */
  remainingSeconds: number;
  /** 1 = full time left, 0 = deadline reached. */
  fraction: number;
  label: string;
}

/** The deadline configured on the Approval node, or null when none is set. */
export function approvalSlaSeconds(config: SiteConfiguration): number | null {
  const node = config.modules.nodes.find((n) => n.moduleType === "approval");
  const v = node?.config?.["slaSeconds"];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/**
 * Only a `submitted` request can breach: once it is decided the clock no longer matters.
 * Returns null when there is nothing to show (not waiting for approval, or no SLA configured).
 */
export function slaState(status: string, ageSeconds: number, slaSeconds: number | null): SlaState | null {
  if (status !== "submitted" || slaSeconds === null) return null;
  const remaining = slaSeconds - ageSeconds;
  const fraction = Math.min(1, Math.max(0, remaining / slaSeconds));
  if (remaining <= 0) return { tone: "breached", remainingSeconds: remaining, fraction: 0, label: `Overdue by ${formatDuration(-remaining)}` };
  const tone: SlaTone = fraction <= 0.3 ? "warning" : "ok";
  return { tone, remainingSeconds: remaining, fraction, label: `${formatDuration(remaining)} left` };
}

/**
 * Age right now, from the server's `ageSeconds` at the moment the data arrived plus time elapsed locally.
 * Using the server's age (not a client-side timestamp comparison) keeps the ring correct when the device clock is wrong.
 */
export const liveAge = (ageSeconds: number, receivedAt: number, now: number): number => ageSeconds + Math.max(0, (now - receivedAt) / 1000);
