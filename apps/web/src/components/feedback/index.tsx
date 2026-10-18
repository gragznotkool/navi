import { AlertCircle, CheckCircle2, Inbox, Info, Loader2, WifiOff, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ApiRequestError } from "../../lib/api";
import { useToasts } from "../../stores/toast";
import { Button } from "../ui";

export function LoadingState({ label = "Loading operational data…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 py-10 font-mono text-xs uppercase tracking-wider text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin text-[#FBBC04]" aria-hidden /> {label}
    </div>
  );
}

export function SkeletonLoader({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`devfest-card p-6 animate-pulse space-y-4 ${className}`} role="status" aria-label="Loading content">
      <div className="flex items-center justify-between pb-3 border-b-2 border-[#1E293B]/20">
        <div className="h-5 w-40 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-7 w-24 rounded-full bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 w-12 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-4 flex-1 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-6 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="devfest-card p-5 animate-pulse" role="status">
      <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700 mb-2" />
      <div className="h-8 w-20 rounded bg-slate-200 dark:bg-slate-700 mb-2" />
      <div className="h-3 w-36 rounded bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="devfest-card flex flex-col items-center gap-2.5 bg-white/90 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">
        <Inbox className="h-6 w-6" aria-hidden />
      </div>
      <p className="font-['Outfit',sans-serif] text-base font-black uppercase tracking-wider text-[#0F172A]">{title}</p>
      {hint && <p className="max-w-md text-xs font-medium text-slate-600">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiRequestError ? error : null;
  const unavailable = e?.unavailable;
  return (
    <div role="alert" className="devfest-card border-l-8 border-l-[#EA4335] p-5">
      <div className="flex items-start gap-3.5">
        {unavailable ? <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#2563EB]" aria-hidden /> : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#EA4335]" aria-hidden />}
        <div className="flex-1">
          <p className="font-mono text-xs font-black uppercase tracking-wider text-[#0F172A]">{unavailable ? "Not available yet" : "SYSTEM ALERT · FAULT DETECTED"}</p>
          <p className="mt-1 text-xs font-medium text-slate-600">{e?.message ?? "Unexpected system error"}</p>
          {onRetry && !unavailable && (
            <Button className="mt-3 font-mono font-bold" onClick={onRetry}>
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
  const color = { success: "text-[#34A853]", error: "text-[#EA4335]", info: "text-[#2563EB]" };
  return (
    <div aria-live="polite" className="fixed bottom-5 right-5 z-50 flex w-88 flex-col gap-2.5">
      {toasts.map((t) => {
        const Icon = icon[t.kind];
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="devfest-card flex items-start gap-3 p-3.5 bg-white">
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color[t.kind]}`} aria-hidden />
            <p className="flex-1 text-xs font-bold text-[#0F172A]">{t.message}</p>
            <button aria-label="Dismiss notification" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-[#0F172A]">
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
