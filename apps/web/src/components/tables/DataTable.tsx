import type { ReactNode } from "react";
import { EmptyState } from "../feedback";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyTitle?: string;
  emptyHint?: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  caption: string;
}

/** Compact, aligned table. Rows are keyboard-activatable when `onRowClick` is provided. */
export function DataTable<T>({ columns, rows, rowKey, emptyTitle = "No records", emptyHint, onRowClick, selectedKey, caption }: Props<T>) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} {...(emptyHint ? { hint: emptyHint } : {})} />;
  return (
    <div className="overflow-x-auto rounded-ui border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const clickable = Boolean(onRowClick);
            return (
              <tr
                key={key}
                {...(clickable ? { tabIndex: 0, onClick: () => onRowClick?.(row), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick?.(row)) } : {})}
                aria-selected={selectedKey === key || undefined}
                className={`border-b border-line last:border-0 ${clickable ? "cursor-pointer hover:bg-slate-50" : ""} ${selectedKey === key ? "bg-slate-50" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 align-middle ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
