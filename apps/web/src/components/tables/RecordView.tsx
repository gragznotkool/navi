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
  /** Split-workspace detail pane. */
  detail?: (r: T) => ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
}

/** One data set, three presentations chosen by the configured layout type. */
export function RecordView<T>({ layout, caption, rows, rowKey, columns, groupBy, groups, card, detail, emptyTitle, emptyHint }: Props<T>) {
  const [selected, setSelected] = useState<T | null>(null);
  const empty = { ...(emptyTitle ? { emptyTitle } : {}), ...(emptyHint ? { emptyHint } : {}) };

  if (layout === "kanban" && groupBy && groups && card) {
    if (rows.length === 0) return <EmptyState title={emptyTitle ?? "No records"} {...(emptyHint ? { hint: emptyHint } : {})} />;
    return (
      <div className="flex min-w-max gap-3" role="group" aria-label={caption}>
        {groups.map((g) => {
          const items = rows.filter((r) => groupBy(r) === g);
          return (
            <section key={g} aria-label={`${g} (${items.length})`} className="w-64 shrink-0 rounded-ui border border-line bg-slate-50">
              <h3 className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {g}
                <span className="tabular-nums">{items.length}</span>
              </h3>
              <ul className="flex flex-col gap-2 p-2">
                {items.map((r) => (
                  <li key={rowKey(r)} className="rounded-ui border border-line bg-surface p-3">
                    {card(r)}
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
