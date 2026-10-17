import { AlertCircle, CheckCircle2, Inbox, Info, Loader2, WifiOff, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ApiRequestError } from "../../lib/api";
import { useToasts } from "../../stores/toast";
import { Button } from "../ui";

export function LoadingState({ label = "Loading operational data…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 py-10 font-mono text-xs uppercase tracking-wider text-[#A5A8A6]">
      <Loader2 className="h-4 w-4 animate-spin text-[#FFE500]" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[4px] border border-dashed border-[#303432] bg-[#111313]/60 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[3px] border border-[#303432] bg-[#171919] text-[#FFE500]">
        <Inbox className="h-5 w-5" aria-hidden />
      </div>
      <p className="font-['Barlow_Condensed',sans-serif] text-base font-bold uppercase tracking-wider text-[#F5F5F0]">{title}</p>
      {hint && <p className="max-w-md text-xs text-[#A5A8A6]">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiRequestError ? error : null;
  const unavailable = e?.unavailable;
  return (
    <div role="alert" className="rounded-[4px] border border-[#FF5C5C]/40 bg-[#171919] p-4 shadow-md">
      <div className="flex items-start gap-3">
        {unavailable ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#63B3ED]" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C5C]" aria-hidden />}
        <div className="flex-1">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-[#F5F5F0]">{unavailable ? "Not available yet" : "SYSTEM ALERT · FAULT DETECTED"}</p>
          <p className="mt-1 text-xs text-[#A5A8A6]">{e?.message ?? "Unexpected system error"}</p>
          {onRetry && !unavailable && (
            <Button className="mt-3 uppercase font-mono" onClick={onRetry}>
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
  const color = { success: "text-[#39D98A]", error: "text-[#FF5C5C]", info: "text-[#63B3ED]" };
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-88 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="flex items-start gap-2.5 rounded-[3px] border border-[#303432] bg-[#171919] p-3 shadow-xl">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color[t.kind]}`} aria-hidden />
            <p className="flex-1 text-xs text-[#F5F5F0]">{t.message}</p>
            <button aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-[#777C79] hover:text-[#FFE500]">
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
