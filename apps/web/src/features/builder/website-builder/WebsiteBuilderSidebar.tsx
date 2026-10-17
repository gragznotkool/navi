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
    <aside aria-label="Website builder" className="flex h-[640px] shrink-0 overflow-hidden xl:h-full rounded-[3px] border border-[#303432] bg-[#111313] text-[#F5F5F0]">
      <div role="tablist" aria-orientation="vertical" aria-label="Builder library" className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-[#303432] bg-[#171919] py-3">
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
              className={`flex w-14 flex-col items-center gap-1 rounded-[3px] py-2 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors ${active ? "bg-[#FFE500]/10 text-[#FFE500]" : "text-[#A5A8A6] hover:bg-[#1f2222] hover:text-[#F5F5F0]"}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </button>
          );
        })}
        <button type="button" onClick={() => onCollapsed(!collapsed)} aria-label={collapsed ? "Expand library" : "Collapse library"} title={collapsed ? "Expand" : "Collapse"} className="mt-auto inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-[#A5A8A6] hover:bg-[#1f2222]">
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {!collapsed && (
        <div id="website-builder-panel" role="tabpanel" aria-label={tab === "templates" ? "Templates" : "Modules"} className="flex w-[340px] flex-col">
          <div className="border-b border-[#303432] bg-[#171919] px-3 pb-3 pt-3">
            <h2 className="font-['Barlow_Condensed',sans-serif] uppercase tracking-wider text-base font-bold">{tab === "templates" ? "Website templates" : "Module library"}</h2>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A5A8A6]" aria-hidden />
              <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={tab === "templates" ? "Search templates…" : "Search modules…"} aria-label={tab === "templates" ? "Search templates" : "Search modules"} className="h-9 w-full rounded-[3px] border border-[#303432] bg-[#111313] pl-8 pr-2.5 text-sm text-[#F5F5F0] placeholder:text-[#777C79] focus:border-[#FFE500] focus:bg-[#151717] focus:outline-none focus:ring-2 focus:ring-[#FFE500]/20" />
            </div>
          </div>
          <div key={tab} className="ws-fade-up min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </div>
      )}
    </aside>
  );
}
