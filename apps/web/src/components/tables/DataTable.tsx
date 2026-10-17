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
    <div className="devfest-card overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs text-[#0F172A]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-[#1E293B] bg-slate-100 font-mono text-xs font-bold tracking-wider uppercase text-slate-700">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y border-[#E2E8F0]">
          {rows.map((row) => {
            const key = rowKey(row);
            const clickable = Boolean(onRowClick);
            const isSelected = selectedKey === key;
            return (
              <tr
                key={key}
                {...(clickable ? { tabIndex: 0, onClick: () => onRowClick?.(row), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick?.(row)) } : {})}
                aria-selected={isSelected || undefined}
                className={`transition-colors ${clickable ? "cursor-pointer hover:bg-blue-50/50" : ""} ${
                  isSelected ? "bg-amber-50 font-bold border-l-4 border-l-[#FBBC04]" : ""
                }`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle ${c.align === "right" ? "text-right font-mono tabular-nums font-bold" : ""}`}>
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
