import { useState, useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckSquare, Search, Square, X } from "lucide-react";
import { EmptyState } from "../feedback";
import { Button } from "../ui";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  sortValue?: (row: T) => string | number | boolean;
}

export interface BulkAction<T> {
  label: string;
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "blue" | "green";
  onClick: (selectedRows: T[], clearSelection: () => void) => void;
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
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  selectable?: boolean;
  bulkActions?: BulkAction<T>[];
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
}

type SortDirection = "asc" | "desc" | null;

/** Compact, aligned table with live search, column sorting, client pagination, and bulk operations. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyTitle = "No records",
  emptyHint,
  onRowClick,
  selectedKey,
  caption,
  searchable = true,
  searchPlaceholder = "Filter records by keyword…",
  pageSize: initialPageSize = 15,
  selectable = false,
  bulkActions,
  selectedKeys: controlledSelectedKeys,
  onSelectionChange,
}: Props<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<string[]>([]);

  const isControlled = controlledSelectedKeys !== undefined;
  const selectedKeys = isControlled ? controlledSelectedKeys : internalSelectedKeys;
  const setSelectedKeys = (keys: string[]) => {
    if (!isControlled) setInternalSelectedKeys(keys);
    onSelectionChange?.(keys);
  };

  const handleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  // 1. Filter rows by search term
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) => {
      // Check all primitive properties of the row
      return Object.values(row as Record<string, unknown>).some((val) => {
        if (val === null || val === undefined) return false;
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          return String(val).toLowerCase().includes(q);
        }
        return false;
      });
    });
  }, [rows, search]);

  // 2. Sort filtered rows
  const sortedRows = useMemo(() => {
    if (!sortKey || !sortDir) return filteredRows;
    const col = columns.find((c) => c.key === sortKey);
    return [...filteredRows].sort((a, b) => {
      let valA: unknown;
      let valB: unknown;
      if (col?.sortValue) {
        valA = col.sortValue(a);
        valB = col.sortValue(b);
      } else {
        valA = (a as Record<string, unknown>)[sortKey];
        valB = (b as Record<string, unknown>)[sortKey];
      }
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      const cmp = valA > valB ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortKey, sortDir, columns]);

  // 3. Paginate
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    if (pageSize === 0) return sortedRows;
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, safePage, pageSize]);

  // Selection helpers
  const allCurrentKeys = paginatedRows.map(rowKey);
  const isAllCurrentSelected = allCurrentKeys.length > 0 && allCurrentKeys.every((k) => selectedKeys.includes(k));
  const hasSomeCurrentSelected = allCurrentKeys.some((k) => selectedKeys.includes(k));

  const toggleSelectAll = () => {
    if (isAllCurrentSelected) {
      setSelectedKeys(selectedKeys.filter((k) => !allCurrentKeys.includes(k)));
    } else {
      const next = Array.from(new Set([...selectedKeys, ...allCurrentKeys]));
      setSelectedKeys(next);
    }
  };

  const toggleSelectRow = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedKeys.includes(key)) {
      setSelectedKeys(selectedKeys.filter((k) => k !== key));
    } else {
      setSelectedKeys([...selectedKeys, key]);
    }
  };

  const clearSelection = () => setSelectedKeys([]);

  const selectedObjects = useMemo(() => {
    return rows.filter((r) => selectedKeys.includes(rowKey(r)));
  }, [rows, selectedKeys, rowKey]);

  if (rows.length === 0 && !search) {
    return <EmptyState title={emptyTitle} {...(emptyHint ? { hint: emptyHint } : {})} />;
  }

  const showSearch = searchable && (rows.length > 3 || search);
  const showBulk = Boolean(selectable || (bulkActions && bulkActions.length > 0));

  return (
    <div className="flex flex-col gap-3">
      {/* Top Filter & Toolbar */}
      {showSearch && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-full border-2 border-[#1E293B] bg-white pl-9 pr-9 font-mono text-xs font-medium text-[#0F172A] shadow-[2px_2px_0px_#1E293B] focus:border-[#FBBC04] focus:outline-none dark:border-[#334155] dark:bg-[#131B2E] dark:text-[#F8FAFC] dark:shadow-[2px_2px_0px_#05070B]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#0F172A] dark:hover:text-white"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing <strong className="text-[#0F172A] dark:text-white">{sortedRows.length}</strong> of {rows.length} records
            </span>
          </div>
        </div>
      )}

      {/* Main Table Container */}
      <div className="devfest-card overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs text-[#0F172A] dark:text-[#F8FAFC]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b-2 border-[#1E293B] bg-slate-100 dark:bg-[#1E293B] font-mono text-xs font-bold tracking-wider uppercase text-slate-700 dark:text-slate-300">
              {showBulk && (
                <th scope="col" className="w-10 px-4 py-3">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    title={isAllCurrentSelected ? "Deselect all" : "Select all on page"}
                    className="flex items-center text-slate-600 hover:text-[#0F172A] dark:text-slate-300 dark:hover:text-white"
                  >
                    {isAllCurrentSelected ? (
                      <CheckSquare className="h-4 w-4 text-[#4285F4]" />
                    ) : hasSomeCurrentSelected ? (
                      <div className="h-4 w-4 rounded border-2 border-[#4285F4] bg-[#4285F4]/30" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
              )}
              {columns.map((c) => {
                const isSorted = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""} ${
                      c.sortable !== false ? "cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-800" : ""
                    }`}
                    onClick={() => c.sortable !== false && handleSort(c.key)}
                  >
                    <div className={`inline-flex items-center gap-1.5 ${c.align === "right" ? "justify-end" : ""}`}>
                      <span>{c.header}</span>
                      {c.sortable !== false && (
                        <span className="text-slate-400 dark:text-slate-500">
                          {isSorted ? (
                            sortDir === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#FBBC04]" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-[#2563EB] dark:text-[#FBBC04]" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40 hover:opacity-100" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (showBulk ? 1 : 0)} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <p className="font-['Outfit',sans-serif] text-base font-bold text-[#0F172A] dark:text-white">
                      No matching records found
                    </p>
                    <p className="font-mono text-xs text-slate-500">Try adjusting your keyword filter “{search}”</p>
                    <Button variant="secondary" className="mt-2" onClick={() => setSearch("")}>
                      Reset search filter
                    </Button>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => {
                const key = rowKey(row);
                const clickable = Boolean(onRowClick);
                const isSelected = selectedKey === key;
                const isChecked = selectedKeys.includes(key);

                return (
                  <tr
                    key={key}
                    {...(clickable
                      ? {
                          tabIndex: 0,
                          onClick: () => onRowClick?.(row),
                          onKeyDown: (e: React.KeyboardEvent) =>
                            (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick?.(row)),
                        }
                      : {})}
                    aria-selected={isSelected || undefined}
                    className={`transition-colors ${
                      clickable ? "cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30" : ""
                    } ${
                      isSelected
                        ? "bg-amber-50 font-bold border-l-4 border-l-[#FBBC04] dark:bg-amber-950/30"
                        : isChecked
                          ? "bg-blue-50/40 dark:bg-blue-950/20"
                          : ""
                    }`}
                  >
                    {showBulk && (
                      <td className="px-4 py-3 align-middle" onClick={(e) => toggleSelectRow(key, e)}>
                        <button type="button" className="text-slate-500 hover:text-[#0F172A] dark:hover:text-white">
                          {isChecked ? (
                            <CheckSquare className="h-4 w-4 text-[#4285F4]" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400" />
                          )}
                        </button>
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-3 align-middle ${
                          c.align === "right" ? "text-right font-mono tabular-nums font-bold" : ""
                        }`}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {sortedRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1 font-mono text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 rounded-lg border-2 border-[#1E293B] bg-white px-2 font-bold text-[#0F172A] shadow-[1px_1px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:text-[#F8FAFC]"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={0}>All</option>
            </select>
            {pageSize > 0 && (
              <span>
                ({(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sortedRows.length)} of {sortedRows.length})
              </span>
            )}
          </div>

          {pageSize > 0 && totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-8 px-2.5 text-xs"
              >
                ◀ Prev
              </Button>
              <span className="px-2 font-bold text-[#0F172A] dark:text-white">
                Page {safePage} / {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-8 px-2.5 text-xs"
              >
                Next ▶
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Floating Bulk Operations Dock */}
      {selectedKeys.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 rounded-2xl border-3 border-[#1E293B] bg-white p-2 px-4 shadow-[5px_5px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[5px_5px_0px_#05070B]">
            <div className="flex items-center gap-2 border-r-2 border-slate-200 pr-3 font-mono text-xs font-bold text-[#0F172A] dark:border-slate-700 dark:text-white">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FBBC04] text-[11px] font-black text-[#0F172A]">
                {selectedKeys.length}
              </span>
              <span>selected</span>
            </div>

            <div className="flex items-center gap-2">
              {bulkActions?.map((action, i) => (
                <Button
                  key={i}
                  variant={action.variant ?? "primary"}
                  onClick={() => action.onClick(selectedObjects, clearSelection)}
                  className="h-8 px-3 text-xs"
                >
                  {action.icon}
                  {action.label}
                </Button>
              ))}

              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
                title="Deselect all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
