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
    <div className="overflow-x-auto rounded-[3px] border border-[#303432] bg-[#171919]">
      <table className="w-full border-collapse text-left text-xs text-[#F5F5F0]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[#303432] bg-[#111313] font-mono text-[11px] font-semibold tracking-wider uppercase text-[#A5A8A6]">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3.5 py-2.5 ${c.align === "right" ? "text-right" : ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#202422]">
          {rows.map((row) => {
            const key = rowKey(row);
            const clickable = Boolean(onRowClick);
            const isSelected = selectedKey === key;
            return (
              <tr
                key={key}
                {...(clickable ? { tabIndex: 0, onClick: () => onRowClick?.(row), onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick?.(row)) } : {})}
                aria-selected={isSelected || undefined}
                className={`transition-colors ${clickable ? "cursor-pointer hover:bg-[#1f2222]" : ""} ${
                  isSelected ? "bg-[#FFE500]/10 border-l-2 border-l-[#FFE500]" : ""
                }`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3.5 py-2.5 align-middle ${c.align === "right" ? "text-right font-mono tabular-nums" : ""}`}>
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
