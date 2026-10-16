import { AlertTriangle, Clock } from "lucide-react";
import { useNow } from "../hooks/useNow";
import { liveAge, slaState, type SlaTone } from "../lib/sla";

const stroke: Record<SlaTone, string> = { ok: "#16a34a", warning: "#d97706", breached: "#dc2626" };
const text: Record<SlaTone, string> = { ok: "text-green-700", warning: "text-amber-700", breached: "text-red-700" };

interface Props {
  status: string;
  /** `ageSeconds` from the server at the moment it was received. */
  ageSeconds: number;
  /** `Date.now()` when that response arrived. */
  receivedAt: number;
  slaSeconds: number | null;
}

/**
 * A countdown ring plus a text badge, so the state is never conveyed by color alone.
 * Renders nothing unless the request is waiting for approval and the site has a deadline.
 */
export function SlaRing({ status, ageSeconds, receivedAt, slaSeconds }: Props) {
  const now = useNow();
  const sla = slaState(status, liveAge(ageSeconds, receivedAt, now), slaSeconds);
  if (!sla) return null;
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${text[sla.tone]}`} data-sla={sla.tone}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="#e2e8f0" strokeWidth="3" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={stroke[sla.tone]}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - sla.fraction)}
          transform="rotate(-90 12 12)"
        />
      </svg>
      {sla.tone === "breached" ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
      <span>{sla.label}</span>
    </span>
  );
}
