import { LayoutDashboard, Lock, Plus } from "lucide-react";
import type { ModuleDefinition, SiteConfiguration } from "@opshub/contracts";
import { moduleIcons } from "../../../runtime/SiteShell";

/** dataTransfer type used when a module card is dragged onto the canvas. */
export const MODULE_DRAG_TYPE = "application/x-opshub-module";

const CATEGORY_LABEL: Record<string, string> = { platform: "Platform", core: "Core", workflow: "Workflow", analytics: "Analytics" };

export function ModuleGallery({ defs, config, query, locked, onAdd, onUnlock }: { defs: readonly ModuleDefinition[]; config: SiteConfiguration; query: string; locked: boolean; onAdd: (type: string) => void; onUnlock?: () => void }) {
  const q = query.trim().toLowerCase();
  const shown = defs.filter((d) => !q || d.displayName.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.category.includes(q));
  const placed = new Set(config.modules.nodes.map((n) => n.moduleType));
  const groups = ["core", "workflow", "analytics", "platform"].map((c) => ({ c, items: shown.filter((d) => d.category === c) })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {locked && (
        <div className="flex items-start gap-2 rounded-[3px] border border-[#FFB547]/30 bg-[#FFB547]/10 p-2.5 text-[11px] text-[#FFB547]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            The template’s structure is locked. Adding a module unlocks it for free editing.
            {onUnlock && <button type="button" onClick={onUnlock} className="ml-1 font-semibold underline underline-offset-2">Unlock now</button>}
          </span>
        </div>
      )}
      <p className="text-[11px] text-[#A5A8A6]">Drag a module onto the canvas, or click to place it.</p>
      {groups.map(({ c, items }) => (
        <section key={c} aria-label={`${CATEGORY_LABEL[c]} modules`}>
          <h3 className="mb-1.5 px-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#777C79]">{CATEGORY_LABEL[c]}</h3>
          <ul className="flex flex-col gap-2">
            {items.map((d) => {
              const Icon = moduleIcons[d.type] ?? LayoutDashboard;
              const on = placed.has(d.type);
              const ins = d.ports.filter((p) => p.direction === "input");
              const outs = d.ports.filter((p) => p.direction === "output");
              return (
                <li key={d.type}>
                  <button
                    type="button"
                    draggable={!on}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(MODULE_DRAG_TYPE, d.type);
                      e.dataTransfer.setData("text/plain", d.type);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => !on && onAdd(d.type)}
                    disabled={on}
                    data-testid={`gallery-${d.type}`}
                    className={`group flex w-full gap-2.5 rounded-xl border-2 p-2.5 text-left transition-all ${
                      on
                        ? "cursor-default border-slate-200 bg-slate-100 opacity-60 dark:border-[#334155] dark:bg-[#0B1120]"
                        : "cursor-grab border-[#1E293B] bg-white shadow-[2px_2px_0px_#1E293B] hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_#1E293B] active:cursor-grabbing dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[2px_2px_0px_#020617]"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-[#1E293B] bg-[#FBBC04] text-[#0F172A] shadow-[1px_1px_0px_#1E293B]">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-bold text-[#0F172A] dark:text-white">{d.displayName}</span>
                        {on ? (
                          <span className="ml-auto shrink-0 rounded-full border border-[#1E293B] bg-[#34A853] px-2 py-0.5 text-[9px] font-black uppercase text-white shadow-[1px_1px_0px_#1E293B]">On canvas</span>
                        ) : (
                          <Plus className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 group-hover:text-[#0F172A] dark:text-slate-400 dark:group-hover:text-white" aria-hidden />
                        )}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-slate-500 dark:text-slate-400 font-medium">{d.description}</span>
                      {(ins.length > 0 || outs.length > 0) && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {ins.map((p) => <span key={p.id} className="rounded-md border border-[#1E293B] bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0F172A] dark:border-[#334155] dark:bg-[#0B1120] dark:text-slate-200">« {p.label}</span>)}
                          {outs.map((p) => <span key={p.id} className="rounded-md border border-[#1E293B] bg-[#FEF3C7] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0F172A] dark:border-[#FBBC04]/50 dark:bg-[#451a03] dark:text-[#FEF08A]">{p.label} »</span>)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="py-6 text-center text-xs text-slate-500 font-bold">No modules match “{query}”.</p>}
    </div>
  );
}
