import { AlertCircle, CheckCircle2, Inbox, Info, Loader2, WifiOff, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ApiRequestError } from "../../lib/api";
import { useToasts } from "../../stores/toast";
import { Button } from "../ui";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-center">
      <Inbox className="h-6 w-6 text-muted" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiRequestError ? error : null;
  const unavailable = e?.unavailable;
  return (
    <div role="alert" className="rounded-ui border border-line bg-surface p-4">
      <div className="flex items-start gap-2">
        {unavailable ? <Info className="mt-0.5 h-4 w-4 text-info" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 text-danger" aria-hidden />}
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">{unavailable ? "Not available yet" : "Something went wrong"}</p>
          <p className="mt-0.5 text-sm text-muted">{e?.message ?? "Unexpected error"}</p>
          {onRetry && !unavailable && (
            <Button className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  const icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  const color = { success: "text-success", error: "text-danger", info: "text-info" };
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="flex items-start gap-2 rounded-ui border border-line bg-surface p-3 shadow-sm">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color[t.kind]}`} aria-hidden />
            <p className="flex-1 text-sm text-ink">{t.message}</p>
            <button aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-amber-100 px-4 py-1.5 text-xs text-amber-900">
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      You are offline. Live data is unavailable and changes cannot be submitted until you reconnect.
    </div>
  );
}
