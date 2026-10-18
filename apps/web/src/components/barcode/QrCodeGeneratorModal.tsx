import { Printer, X, Download, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui";
import { notify } from "../../stores/toast";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sku: string;
  name: string;
  location?: string;
}

export function QrCodeGeneratorModal({ isOpen, onClose, sku, name, location = "WAREHOUSE A-04" }: Props) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(sku);
    setCopied(true);
    notify.success(`SKU copied: ${sku}`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border-3 border-[#1E293B] bg-white p-6 shadow-[8px_8px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[8px_8px_0px_#05070B]">
        <div className="flex items-center justify-between border-b-2 border-slate-200 pb-3 dark:border-slate-800">
          <div>
            <h2 className="font-['Outfit',sans-serif] text-base font-black uppercase tracking-wider text-[#0F172A] dark:text-white">
              Inventory QR / Barcode Tag
            </h2>
            <p className="font-mono text-[10px] text-slate-500">INDUSTRIAL BIN LABEL SPECIFICATION</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Printable Physical Sticker Preview */}
        <div className="my-5 flex justify-center">
          <div className="w-80 rounded-xl border-3 border-[#1E293B] bg-white p-4 text-[#0F172A] shadow-[4px_4px_0px_#1E293B]">
            <div className="flex items-start justify-between border-b-2 border-[#1E293B] pb-2">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-widest text-[#2563EB]">
                  NAVI OPS · ASSET TAG
                </span>
                <p className="font-['Outfit',sans-serif] text-sm font-black leading-tight text-[#0F172A]">{name}</p>
              </div>
              <span className="rounded bg-[#FBBC04] border border-[#1E293B] px-1.5 py-0.5 font-mono text-[9px] font-black">
                PASS
              </span>
            </div>

            {/* Generated SVG QR Code representation */}
            <div className="my-3 flex items-center justify-center gap-4">
              <svg className="h-28 w-28 shrink-0" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Standard QR Corner Finders */}
                <rect x="5" y="5" width="26" height="26" fill="#0F172A" />
                <rect x="9" y="9" width="18" height="18" fill="white" />
                <rect x="13" y="13" width="10" height="10" fill="#0F172A" />

                <rect x="69" y="5" width="26" height="26" fill="#0F172A" />
                <rect x="73" y="9" width="18" height="18" fill="white" />
                <rect x="77" y="13" width="10" height="10" fill="#0F172A" />

                <rect x="5" y="69" width="26" height="26" fill="#0F172A" />
                <rect x="9" y="73" width="18" height="18" fill="white" />
                <rect x="13" y="77" width="10" height="10" fill="#0F172A" />

                {/* Matrix Dots */}
                <rect x="36" y="8" width="6" height="6" fill="#0F172A" />
                <rect x="48" y="14" width="6" height="6" fill="#0F172A" />
                <rect x="58" y="8" width="6" height="6" fill="#0F172A" />
                <rect x="38" y="24" width="6" height="6" fill="#0F172A" />
                <rect x="50" y="28" width="6" height="6" fill="#0F172A" />
                <rect x="8" y="38" width="6" height="6" fill="#0F172A" />
                <rect x="20" y="44" width="6" height="6" fill="#0F172A" />
                <rect x="38" y="40" width="8" height="8" fill="#0F172A" />
                <rect x="52" y="44" width="6" height="6" fill="#0F172A" />
                <rect x="68" y="38" width="6" height="6" fill="#0F172A" />
                <rect x="82" y="44" width="6" height="6" fill="#0F172A" />
                <rect x="38" y="56" width="6" height="6" fill="#0F172A" />
                <rect x="50" y="60" width="6" height="6" fill="#0F172A" />
                <rect x="62" y="54" width="6" height="6" fill="#0F172A" />
                <rect x="76" y="62" width="6" height="6" fill="#0F172A" />
                <rect x="38" y="72" width="6" height="6" fill="#0F172A" />
                <rect x="48" y="80" width="6" height="6" fill="#0F172A" />
                <rect x="64" y="76" width="6" height="6" fill="#0F172A" />
                <rect x="80" y="82" width="6" height="6" fill="#0F172A" />
              </svg>

              <div className="flex flex-col gap-1 font-mono text-xs">
                <div>
                  <span className="text-[9px] uppercase text-slate-500">PART SKU</span>
                  <p className="font-black text-[#0F172A] tracking-wider">{sku}</p>
                </div>
                <div>
                  <span className="text-[9px] uppercase text-slate-500">STORAGE LOCATION</span>
                  <p className="font-bold text-slate-800">{location}</p>
                </div>
                <div>
                  <span className="text-[9px] uppercase text-slate-500">ISO AUDIT COMPLIANT</span>
                  <p className="text-[10px] text-slate-700">Class A · IEC 61340</p>
                </div>
              </div>
            </div>

            {/* Linear barcode footer */}
            <div className="flex flex-col items-center border-t-2 border-[#1E293B] pt-2">
              <div className="flex h-6 w-full items-center justify-center gap-0.5">
                {[2, 1, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 3, 2, 1, 2, 3, 1, 4].map((w, idx) => (
                  <div key={idx} className="h-full bg-[#0F172A]" style={{ width: `${w * 2}px` }} />
                ))}
              </div>
              <span className="mt-1 font-mono text-[9px] font-bold tracking-widest text-[#0F172A]">*{sku}*</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center border-t-2 border-slate-200 pt-3 dark:border-slate-800">
          <Button variant="secondary" onClick={handleCopy} className="gap-1.5 text-xs">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied SKU" : "Copy SKU"}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={handlePrint} className="gap-1.5">
              <Printer className="h-4 w-4" /> Print Sticker
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
