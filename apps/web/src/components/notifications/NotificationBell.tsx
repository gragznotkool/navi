import { useState, useRef, useEffect } from "react";
import { Bell, Check, Radio } from "lucide-react";
import { useActivityStore } from "../../stores/activityFeed";

interface Props {
  onOpenFeed?: () => void;
}

export function NotificationBell({ onOpenFeed }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { events, markAllRead, markRead } = useActivityStore();

  const unread = events.filter((e) => !e.read);
  const unreadCount = unread.length;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title={`${unreadCount} unread operational alerts`}
        aria-label={`${unreadCount} unread operational alerts`}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#1E293B] bg-white font-mono text-xs font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B] transition-transform hover:-translate-y-0.5 active:translate-y-0.5 dark:border-[#334155] dark:bg-[#1E293B] dark:text-white dark:shadow-[2px_2px_0px_#05070B]"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-[#1E293B] bg-[#EA4335] px-1 font-mono text-[9px] font-black text-white shadow-[1px_1px_0px_#1E293B]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 rounded-2xl border-3 border-[#1E293B] bg-white shadow-[6px_6px_0px_#1E293B] overflow-hidden z-50 dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[6px_6px_0px_#05070B] animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b-2 border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
            <span className="font-['Outfit',sans-serif] text-xs font-black uppercase tracking-wider text-[#0F172A] dark:text-white">
              Notifications {unreadCount > 0 && `(${unreadCount})`}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="font-mono text-[10px] font-bold text-[#2563EB] hover:underline dark:text-[#FBBC04]"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {events.slice(0, 5).map((evt) => (
              <li
                key={evt.id}
                onClick={() => markRead(evt.id)}
                className={`p-3 cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  !evt.read ? "bg-amber-50/50 dark:bg-amber-950/20" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <p className="font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A] dark:text-white">
                    {evt.title}
                  </p>
                  {!evt.read && (
                    <span className="h-2 w-2 rounded-full bg-[#EA4335] shrink-0 mt-1" />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-600 dark:text-slate-400">
                  {evt.description}
                </p>
              </li>
            ))}
          </ul>

          <div className="border-t-2 border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-800 dark:bg-slate-900/60">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenFeed?.();
              }}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#2563EB] hover:underline dark:text-[#FBBC04]"
            >
              <Radio className="h-3 w-3" /> Open Live Operations Feed →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
