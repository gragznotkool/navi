import { useEffect } from "react";
import { WifiOff, ShieldAlert, Database, RefreshCw, ZapOff } from "lucide-react";
import { useDeadZoneStore } from "../../stores/deadZoneStore";

/**
 * Dead-Zone Lite Banner & Health Monitor:
 * 1. Automatically monitors navigator.onLine and health pings.
 * 2. Provides demo-mode "Simulate Network Drop" button for hackathon judges.
 * 3. Safely alerts user and disables write actions while rendering cached snapshot.
 */
export function DeadZoneBanner() {
  const { isOffline, simulatedOffline, setOfflineStatus, setSimulatedOffline } = useDeadZoneStore();
  const effectiveOffline = isOffline || simulatedOffline;

  useEffect(() => {
    const handleOnline = () => setOfflineStatus(false);
    const handleOffline = () => setOfflineStatus(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Heartbeat ping check
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/health", { method: "HEAD", cache: "no-store" });
        if (!res.ok) setOfflineStatus(true);
      } catch {
        // ping failure
      }
    }, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [setOfflineStatus]);

  return (
    <>
      {/* Floating Demo Control Toggle for Hackathon Judges */}
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSimulatedOffline(!simulatedOffline)}
          title="Toggle Dead-Zone Lite offline demo mode"
          className={`flex items-center gap-1.5 rounded-full border-2 border-[#1E293B] px-3 py-1.5 font-['Outfit',sans-serif] text-xs font-black shadow-[3px_3px_0px_#1E293B] transition-all active:translate-x-[1px] active:translate-y-[1px] ${
            simulatedOffline
              ? "bg-[#EA4335] text-white animate-pulse"
              : "bg-[#FBBC04] text-[#1E293B] hover:bg-[#F59E0B]"
          }`}
        >
          {simulatedOffline ? <ZapOff className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
          <span>{simulatedOffline ? "Offline Mode (Simulated)" : "Simulate Dead-Zone Drop"}</span>
        </button>
      </div>

      {/* Prominent Offline Banner */}
      {effectiveOffline && (
        <div
          role="alert"
          className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#1E293B] bg-[#EA4335] px-4 py-2.5 text-white shadow-[0_4px_12px_rgba(234,67,53,0.3)]"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white bg-black/20">
              <WifiOff className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-wider">
                  Dead-Zone Lite Active
                </span>
                <span className="rounded bg-black/30 px-1.5 py-0.2 font-mono text-[10px] font-bold">
                  IndexedDB Pre-warmed
                </span>
              </div>
              <p className="text-[11px] font-medium text-white/90">
                Network connection severed. Serving local snapshot from IndexedDB cache. Destructive write buttons disabled for data integrity.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded border border-white/40 bg-black/20 px-2 py-1 text-[11px] font-mono font-bold">
              <ShieldAlert className="h-3.5 w-3.5 text-[#FBBC04]" />
              <span>Writes Guarded</span>
            </div>
            {simulatedOffline && (
              <button
                type="button"
                onClick={() => setSimulatedOffline(false)}
                className="flex items-center gap-1 rounded border border-white bg-white px-2 py-1 text-[11px] font-bold text-[#EA4335] hover:bg-slate-100"
              >
                <RefreshCw className="h-3 w-3" /> Reconnect
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
