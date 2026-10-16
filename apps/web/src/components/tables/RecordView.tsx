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
              className="w-72 shrink-0 rounded-ui border border-line bg-slate-50 transition-colors"
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
              <h3 className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <span>{g}</span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700 tabular-nums">
                  {items.length}
                </span>
              </h3>
              <ul className="flex min-h-[140px] flex-col gap-2 p-2">
                {items.length === 0 && (
                  <li className="grid place-items-center py-6 text-xs text-muted">Nothing in {g}</li>
                )}
                {items.map((r) => (
                  <li
                    key={rowKey(r)}
                    draggable={Boolean(onMove)}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", rowKey(r))}
                    className={`rounded-ui border border-line bg-surface p-3 shadow-xs transition-shadow hover:shadow-sm ${
                      onMove ? "cursor-grab active:cursor-grabbing" : ""
                    }`}
                  >
                    {card(r)}
                    {onMove && (
                      <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-2">
                        <label className="text-[11px] text-muted">Move to:</label>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) onMove(r, e.target.value);
                          }}
                          className="h-6 rounded border border-line bg-surface px-1.5 text-xs text-ink"
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
