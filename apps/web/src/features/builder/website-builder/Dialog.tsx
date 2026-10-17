import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Light dialog for the website builder: Escape closes, focus moves in and returns to the opener. */
export function Dialog({ label, onClose, children, width = "max-w-md" }: { label: string; onClose: () => void; children: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`ws-pop relative w-full ${width} max-h-[88vh] overflow-auto rounded-[3px] border border-[#303432] bg-[#171919] text-[#F5F5F0] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.6)] outline-none`}>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-[#A5A8A6] hover:bg-[#1f2222] hover:text-[#F5F5F0]">
          <X className="h-4 w-4" aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}
