import { useState, type ReactNode } from "react";
import type { LayoutType } from "@opshub/contracts";
import { DataTable, type Column } from "./DataTable";
import { EmptyState } from "../feedback";

interface Props<T> {
  layout: LayoutType;
  caption: string;
  rows: T[];
  rowKey: (r: T) => string;
  columns: Column<T>[];
  /** Kanban grouping. */
  groupBy?: (r: T) => string;
  groups?: string[];
  card?: (r: T) => ReactNode;
  onMove?: (row: T, toGroup: string) => void;
  /** Split-workspace detail pane. */
  detail?: (r: T) => ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
}

/** One data set, three presentations chosen by the configured layout type. */
export function RecordView<T>({ layout, caption, rows, rowKey, columns, groupBy, groups, card, onMove, detail, emptyTitle, emptyHint }: Props<T>) {
  const [selected, setSelected] = useState<T | null>(null);
  const empty = { ...(emptyTitle ? { emptyTitle } : {}), ...(emptyHint ? { emptyHint } : {}) };

  if (layout === "kanban" && groupBy && groups && card) {
    if (rows.length === 0) return <EmptyState title={emptyTitle ?? "No records"} {...(emptyHint ? { hint: emptyHint } : {})} />;
    return (
      <div className="flex min-w-max gap-4 overflow-x-auto pb-4" role="group" aria-label={caption}>
        {groups.map((g) => {
          const items = rows.filter((r) => groupBy(r) === g);
          return (
            <section
              key={g}
              aria-label={`${g} (${items.length})`}
              className="devfest-card w-72 shrink-0 overflow-hidden bg-slate-50 transition-colors dark:bg-[#0B1120]"
              onDragOver={(e) => {
                if (onMove) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!onMove) return;
                const key = e.dataTransfer.getData("text/plain");
                const row = rows.find((r) => rowKey(r) === key);
                if (row && groupBy(row) !== g) onMove(row, g);
              }}
            >
              <h3 className="flex items-center justify-between border-b-2 border-[#1E293B] bg-white px-4 py-3 font-['Outfit',sans-serif] text-sm font-black uppercase tracking-wider text-[#0F172A] dark:border-[#334155] dark:bg-[#1E293B] dark:text-white">
                <span>{g}</span>
                <span className="rounded-full border-2 border-[#1E293B] bg-[#FBBC04] px-2.5 py-0.5 font-mono text-[11px] font-black text-[#0F172A] tabular-nums shadow-[1px_1px_0px_#1E293B]">
                  {items.length}
                </span>
              </h3>
              <ul className="flex min-h-[140px] flex-col gap-2.5 p-3">
                {items.length === 0 && (
                  <li className="grid place-items-center py-6 text-xs font-bold text-slate-400 dark:text-slate-500">Nothing in {g}</li>
                )}
                {items.map((r) => (
                  <li
                    key={rowKey(r)}
                    draggable={Boolean(onMove)}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", rowKey(r))}
                    className={`rounded-xl border-2 border-[#1E293B] bg-white p-3.5 shadow-[2px_2px_0px_#1E293B] transition-all hover:translate-y-[-1px] dark:border-[#334155] dark:bg-[#131B2E] dark:text-slate-100 dark:shadow-[2px_2px_0px_#05070B] ${
                      onMove ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                  >
                    {card(r)}
                    {onMove && (
                      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2.5 dark:border-slate-700">
                        <label className="font-mono text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Move to:</label>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) onMove(r, e.target.value);
                          }}
                          className="h-7 rounded-full border-2 border-[#1E293B] bg-slate-50 px-2 text-xs font-bold text-[#0F172A] focus:border-[#FBBC04] dark:border-[#334155] dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Choose…</option>
                          {groups
                            .filter((target) => target !== g)
                            .map((target) => (
                              <option key={target} value={target}>
                                {target}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  if (layout === "split-workspace" && detail) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DataTable caption={caption} rows={rows} rowKey={rowKey} columns={columns} onRowClick={setSelected} selectedKey={selected ? rowKey(selected) : null} {...empty} />
        <aside aria-label="Details" className="devfest-card p-5 lg:sticky lg:top-4 lg:self-start">
          {selected ? detail(selected) : <EmptyState title="Nothing selected" hint="Select a row to see its details here." />}
        </aside>
      </div>
    );
  }

  return <DataTable caption={caption} rows={rows} rowKey={rowKey} columns={columns} {...empty} />;
}
