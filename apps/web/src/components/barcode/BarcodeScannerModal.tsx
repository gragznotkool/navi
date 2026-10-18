import { useState, useEffect, useRef } from "react";
import { Camera, CheckCircle2, QrCode, ScanLine, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "../ui";
import { notify } from "../../stores/toast";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (sku: string) => void;
}

const SAMPLE_BARCODES = [
  { sku: "CAP-ELEC-450V", name: "Electrolytic Cap 450V 100uF", stock: "84 pcs" },
  { sku: "STM32F401-MCU", name: "STM32F401 ARM Cortex-M4 IC", stock: "12 pcs" },
  { sku: "OMR-RELAY-12V", name: "Omron 12V High-Current Relay", stock: "45 pcs" },
  { sku: "PCB-2026-X884", name: "Bajaj Induction Main PCB v2", stock: "3 units" },
  { sku: "FUSE-FAST-3A", name: "Fast Blow Fuse 3.15A 250V", stock: "150 pcs" },
];

export function BarcodeScannerModal({ isOpen, onClose, onScan }: Props) {
  const [manualCode, setManualCode] = useState("");
  const [scannedResult, setScannedResult] = useState<{ sku: string; name?: string; stock?: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scanning, setScanning] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Synthesize industrial beep sound on barcode scan
  const playBeep = () => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // AudioContext unavailable
    }
  };

  const handleScanSuccess = (sku: string, name?: string, stock?: string) => {
    playBeep();
    setScannedResult({ sku, name, stock });
    setScanning(false);
    notify.success(`Scanned: ${sku}`);
    onScan?.(sku);
  };

  useEffect(() => {
    if (isOpen) {
      setScanning(true);
      setScannedResult(null);
      setManualCode("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border-3 border-[#1E293B] bg-white p-6 shadow-[8px_8px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[8px_8px_0px_#05070B]">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-slate-200 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[2px_2px_0px_#1E293B]">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-['Outfit',sans-serif] text-base font-black uppercase tracking-wider text-[#0F172A] dark:text-white">
                Optical Barcode / QR Scanner
              </h2>
              <p className="font-mono text-[10px] text-slate-500">INDUSTRIAL OPTICAL SCAN ENGINE v2.4</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
              title={soundEnabled ? "Mute beep sound" : "Enable beep sound"}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-[#34A853]" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Viewfinder Canvas */}
        <div className="relative mt-4 overflow-hidden rounded-xl border-2 border-[#1E293B] bg-slate-950 p-4 shadow-[4px_4px_0px_#1E293B]">
          <div className="relative flex h-52 flex-col items-center justify-center">
            {/* Corner Aim Markers */}
            <div className="absolute top-2 left-2 h-6 w-6 border-t-3 border-l-3 border-[#FBBC04]" />
            <div className="absolute top-2 right-2 h-6 w-6 border-t-3 border-r-3 border-[#FBBC04]" />
            <div className="absolute bottom-2 left-2 h-6 w-6 border-b-3 border-l-3 border-[#FBBC04]" />
            <div className="absolute bottom-2 right-2 h-6 w-6 border-b-3 border-r-3 border-[#FBBC04]" />

            {/* Sweeping Laser Line Animation */}
            {scanning && (
              <div
                className="absolute left-4 right-4 h-0.5 bg-[#EA4335] shadow-[0_0_12px_#EA4335,0_0_4px_#FBBC04] animate-bounce"
                style={{ animationDuration: "2s" }}
              />
            )}

            {scannedResult ? (
              <div className="flex flex-col items-center gap-2 text-center text-white animate-in zoom-in-95 duration-150">
                <CheckCircle2 className="h-10 w-10 text-[#34A853]" />
                <span className="font-mono text-lg font-bold text-[#FBBC04] tracking-wider">{scannedResult.sku}</span>
                {scannedResult.name && <span className="text-xs text-slate-300 font-medium">{scannedResult.name}</span>}
                {scannedResult.stock && (
                  <span className="rounded-full bg-[#34A853]/20 border border-[#34A853] px-2.5 py-0.5 text-[11px] font-mono text-[#34A853]">
                    In Stock: {scannedResult.stock}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <QrCode className="h-12 w-12 text-slate-600 animate-pulse" />
                <p className="font-mono text-xs font-bold text-slate-400">Position barcode or QR inside reticle</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  OPTICAL SENSOR ACTIVE
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Simulated Samples */}
        <div className="mt-4">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Simulate Handheld Optical Scan:
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SAMPLE_BARCODES.map((item) => (
              <button
                key={item.sku}
                type="button"
                onClick={() => handleScanSuccess(item.sku, item.name, item.stock)}
                className="flex flex-col items-start rounded-lg border-2 border-slate-300 bg-slate-50 p-2 text-left transition hover:border-[#FBBC04] hover:bg-amber-50/60 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#FBBC04]"
              >
                <span className="font-mono text-[11px] font-bold text-[#0F172A] dark:text-white">{item.sku}</span>
                <span className="truncate text-[10px] text-slate-500">{item.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Manual Input Fallback */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manualCode.trim()) {
                handleScanSuccess(manualCode.trim());
              }
            }}
            placeholder="Or type SKU manually (e.g. CAP-ELEC-450V)…"
            className="h-9 flex-1 rounded-xl border-2 border-[#1E293B] bg-white px-3 font-mono text-xs font-medium text-[#0F172A] shadow-[2px_2px_0px_#1E293B] focus:border-[#FBBC04] focus:outline-none dark:border-[#334155] dark:bg-[#131B2E] dark:text-[#F8FAFC]"
          />
          <Button
            variant="primary"
            disabled={!manualCode.trim()}
            onClick={() => manualCode.trim() && handleScanSuccess(manualCode.trim())}
          >
            Submit
          </Button>
        </div>

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-2 border-t-2 border-slate-200 pt-3 dark:border-slate-800">
          {scannedResult ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setScannedResult(null);
                  setScanning(true);
                }}
              >
                Scan Another
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                }}
              >
                Confirm & Use SKU
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
