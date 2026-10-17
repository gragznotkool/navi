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
      <div className="flex min-w-max gap-3 overflow-x-auto pb-4" role="group" aria-label={caption}>
        {groups.map((g) => {
          const items = rows.filter((r) => groupBy(r) === g);
          return (
            <section
              key={g}
              aria-label={`${g} (${items.length})`}
              className="w-72 shrink-0 rounded-[4px] border border-[#303432] bg-[#111313] transition-colors"
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
              <h3 className="flex items-center justify-between border-b border-[#303432] bg-[#171919] px-3 py-2.5 font-['Barlow_Condensed',sans-serif] text-xs font-bold uppercase tracking-wider text-[#F5F5F0]">
                <span>{g}</span>
                <span className="rounded-[2px] border border-[#FFE500]/40 bg-[#FFE500]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#FFE500] tabular-nums">
                  {items.length}
                </span>
              </h3>
              <ul className="flex min-h-[140px] flex-col gap-2 p-2">
                {items.length === 0 && (
                  <li className="grid place-items-center py-6 text-xs text-[#777C79]">Nothing in {g}</li>
                )}
                {items.map((r) => (
                  <li
                    key={rowKey(r)}
                    draggable={Boolean(onMove)}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", rowKey(r))}
                    className={`rounded-[3px] border border-[#303432] bg-[#171919] p-3 shadow-sm transition-all hover:border-[#FFE500]/50 ${
                      onMove ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                  >
                    {card(r)}
                    {onMove && (
                      <div className="mt-2.5 flex items-center justify-between border-t border-[#303432] pt-2">
                        <label className="font-mono text-[10px] uppercase text-[#A5A8A6]">Move to:</label>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) onMove(r, e.target.value);
                          }}
                          className="h-6 rounded-[2px] border border-[#303432] bg-[#111313] px-1.5 text-xs text-[#F5F5F0] focus:border-[#FFE500]"
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
        <aside aria-label="Details" className="rounded-ui border border-line bg-surface p-4 lg:sticky lg:top-4 lg:self-start">
          {selected ? detail(selected) : <EmptyState title="Nothing selected" hint="Select a row to see its details here." />}
        </aside>
      </div>
    );
  }

  return <DataTable caption={caption} rows={rows} rowKey={rowKey} columns={columns} {...empty} />;
}
