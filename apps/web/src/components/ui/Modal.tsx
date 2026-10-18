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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="devfest-card flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden outline-none bg-white dark:bg-[#131B2E] dark:border-[#334155]"
      >
        <div className="flex items-center justify-between border-b-2 border-[#1E293B] bg-slate-100 px-5 py-3.5 dark:border-[#334155] dark:bg-[#1E293B]">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full bg-[#FBBC04] border border-[#1E293B]" aria-hidden="true" />
            <h2 className="font-['Outfit',sans-serif] text-base font-black uppercase tracking-wider text-[#0F172A] dark:text-white">{title}</h2>
          </div>
        </div>
        <div className="overflow-auto p-5 text-xs text-[#0F172A] dark:text-slate-200">{children}</div>
        {footer && <div className="flex justify-end gap-2.5 border-t-2 border-[#1E293B] bg-slate-50 px-5 py-3.5 dark:border-[#334155] dark:bg-[#1E293B]">{footer}</div>}
      </div>
    </div>
  );
}
