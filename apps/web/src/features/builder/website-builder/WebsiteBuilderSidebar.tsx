import "../../../styles/website.css";
import { ChevronsLeft, ChevronsRight, LayoutTemplate, Puzzle, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useCanBuildWebsites } from "../../../stores/session";

export type SidebarTab = "templates" | "modules";

const TABS: { id: SidebarTab; label: string; icon: typeof Puzzle }[] = [
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "modules", label: "Modules", icon: Puzzle },
];

/** Canva-style left sidebar: an icon rail with two tabs and a searchable panel. */
export function WebsiteBuilderSidebar({ tab, onTab, collapsed, onCollapsed, query, onQuery, children }: { tab: SidebarTab; onTab: (t: SidebarTab) => void; collapsed: boolean; onCollapsed: (c: boolean) => void; query: string; onQuery: (q: string) => void; children: ReactNode }) {
  // Platform administrators only, even if a caller forgets to check.
  if (!useCanBuildWebsites()) return null;
  return (
    <aside aria-label="Website builder" className="flex h-[640px] shrink-0 overflow-hidden xl:h-full rounded-2xl border-2 border-[#1E293B] bg-white text-[#0F172A] shadow-[4px_4px_0px_#1E293B]">
      <div role="tablist" aria-orientation="vertical" aria-label="Builder library" className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 border-r-2 border-[#1E293B] bg-slate-50 py-3">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id && !collapsed;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="website-builder-panel"
              onClick={() => {
                if (tab === id) onCollapsed(!collapsed);
                else {
                  onTab(id);
                  onCollapsed(false);
                }
              }}
              className={`flex w-14 flex-col items-center gap-1 rounded-xl border-2 py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${
                active
                  ? "border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[2px_2px_0px_#1E293B]"
                  : "border-transparent text-slate-600 hover:border-[#1E293B] hover:bg-white hover:text-[#0F172A]"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand library" : "Collapse library"}
          title={collapsed ? "Expand" : "Collapse"}
          className="mt-auto inline-flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[#1E293B] bg-white text-[#0F172A] shadow-[2px_2px_0px_#1E293B] hover:bg-[#FBBC04]"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {!collapsed && (
        <div id="website-builder-panel" role="tabpanel" aria-label={tab === "templates" ? "Templates" : "Modules"} className="flex w-[340px] flex-col">
          <div className="border-b-2 border-[#1E293B] bg-white px-3 pb-3 pt-3">
            <h2 className="font-['Outfit',sans-serif] text-base font-extrabold uppercase tracking-wider text-[#0F172A]">{tab === "templates" ? "Website templates" : "Module library"}</h2>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder={tab === "templates" ? "Search templates…" : "Search modules…"}
                aria-label={tab === "templates" ? "Search templates" : "Search modules"}
                className="h-10 w-full rounded-xl border-2 border-[#1E293B] bg-slate-50 pl-8 pr-2.5 text-sm font-medium text-[#0F172A] placeholder:text-slate-400 shadow-[2px_2px_0px_#1E293B] focus:border-[#4285F4] focus:outline-none"
              />
            </div>
          </div>
          <div key={tab} className="ws-fade-up min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </div>
      )}
    </aside>
  );
}
