import { useEffect, useRef, type ReactNode } from "react";

/** Minimal accessible dialog: Escape closes, focus moves into it and returns to the opener on close. */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-[4px] border border-[#303432] bg-[#171919] shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-[#303432] bg-[#111313] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 bg-[#FFE500]" aria-hidden="true" />
            <h2 className="font-['Barlow_Condensed',sans-serif] text-base font-bold uppercase tracking-wider text-[#F5F5F0]">{title}</h2>
          </div>
        </div>
        <div className="overflow-auto px-4 py-4 text-xs text-[#F5F5F0]">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[#303432] bg-[#111313] px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
