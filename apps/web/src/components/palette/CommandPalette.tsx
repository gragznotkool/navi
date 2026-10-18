import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  ClipboardList,
  Command,
  FileSpreadsheet,
  GitBranch,
  History,
  LayoutDashboard,
  Moon,
  QrCode,
  Radio,
  Search,
  ShieldCheck,
  Sun,
  Wrench,
  X,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { useSession } from "../../stores/session";
import { useThemeStore } from "../../stores/theme";
import { useSiteRuntime } from "../../runtime/context";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenScanner?: () => void;
  onOpenActivityFeed?: () => void;
}

interface CommandItem {
  id: string;
  category: "Actions" | "Pages" | "Sites" | "Tools";
  title: string;
  subtitle?: string;
  icon: typeof Command;
  action: () => void;
  keywords?: string[];
  shortcut?: string;
}

export function CommandPalette({ isOpen, onClose, onOpenScanner, onOpenActivityFeed }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const navigate = useNavigate();

  const session = useSession((s) => s.session);
  const { resolvedTheme, toggleTheme } = useThemeStore();

  // Try to read site runtime if we're inside a site context
  let runtime: ReturnType<typeof useSiteRuntime> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    runtime = useSiteRuntime();
  } catch {
    runtime = null;
  }

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build command list
  const commands: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [];

    // 1. Core Quick Actions
    list.push({
      id: "toggle-theme",
      category: "Actions",
      title: resolvedTheme === "dark" ? "Switch to Light Mode" : "Switch to Cyberpunk Dark Mode",
      subtitle: "Toggle platform color system",
      icon: resolvedTheme === "dark" ? Sun : Moon,
      action: () => {
        toggleTheme();
        onClose();
      },
      keywords: ["theme", "dark", "light", "mode", "night", "color"],
      shortcut: "⌘D",
    });

    if (onOpenScanner) {
      list.push({
        id: "open-scanner",
        category: "Tools",
        title: "Optical Barcode & QR Scanner",
        subtitle: "Launch hardware laser simulation viewfinder",
        icon: QrCode,
        action: () => {
          onClose();
          onOpenScanner();
        },
        keywords: ["barcode", "qr", "scanner", "camera", "sku"],
        shortcut: "⌘B",
      });
    }

    if (onOpenActivityFeed) {
      list.push({
        id: "open-activity",
        category: "Tools",
        title: "Live Operations Telemetry Stream",
        subtitle: "Open real-time radar activity feed drawer",
        icon: Radio,
        action: () => {
          onClose();
          onOpenActivityFeed();
        },
        keywords: ["feed", "stream", "live", "telemetry", "events", "radar", "updates"],
        shortcut: "⌘L",
      });
    }

    list.push({
      id: "trust-console",
      category: "Tools",
      title: "Trust & Security Console",
      subtitle: "Execute cryptographic RLS & immutability proofs",
      icon: ShieldCheck,
      action: () => {
        navigate("/trust");
        onClose();
      },
      keywords: ["security", "trust", "rls", "proof", "isolation", "audit"],
    });

    // 2. Navigation within active site
    if (runtime) {
      const { basePath, config, permissions } = runtime;

      config.navigation.forEach((n) => {
        const page = config.pages.find((p) => p.id === n.pageId);
        if (!page) return;
        if (page.requiredPermission && !permissions.has(page.requiredPermission)) return;

        let icon = LayoutDashboard;
        if (page.path.includes("inventory")) icon = Boxes;
        else if (page.path.includes("request")) icon = ClipboardList;
        else if (page.path.includes("repair")) icon = Wrench;
        else if (page.path.includes("return")) icon = RotateCcw;
        else if (page.path.includes("report")) icon = FileSpreadsheet;

        list.push({
          id: `page-${page.path}`,
          category: "Pages",
          title: `Jump to ${n.label}`,
          subtitle: `Active site: ${config.name} (${page.path})`,
          icon,
          action: () => {
            navigate(`${basePath}/${page.path}`);
            onClose();
          },
          keywords: [n.label, page.title, page.path],
        });
      });

      if (permissions.has("config:manage")) {
        list.push({
          id: "admin-builder",
          category: "Pages",
          title: "Configuration Builder",
          subtitle: "Visual node graph editor and layout designer",
          icon: GitBranch,
          action: () => {
            navigate(`${basePath}/admin/builder`);
            onClose();
          },
          keywords: ["builder", "designer", "workflow", "nodes", "config"],
        });
        list.push({
          id: "admin-releases",
          category: "Pages",
          title: "Releases & Rewind History",
          subtitle: "Publish changes, review diffs, or rollback",
          icon: History,
          action: () => {
            navigate(`${basePath}/admin/releases`);
            onClose();
          },
          keywords: ["releases", "publish", "rollback", "rewind", "audit", "history"],
        });
      }
    }

    // 3. Switch site
    if (session?.memberships) {
      session.memberships.forEach((m) => {
        list.push({
          id: `switch-site-${m.siteId}`,
          category: "Sites",
          title: `Switch to Location: ${m.siteSlug.toUpperCase()}`,
          subtitle: `Site role: ${m.roles.join(", ")}`,
          icon: Boxes,
          action: () => {
            navigate(`/s/${m.siteSlug}`);
            onClose();
          },
          keywords: ["site", "location", m.siteSlug, ...m.roles],
        });
      });
    }

    return list;
  }, [resolvedTheme, toggleTheme, onOpenScanner, onOpenActivityFeed, runtime, session, navigate, onClose]);

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true;
      if (c.subtitle?.toLowerCase().includes(q)) return true;
      if (c.category.toLowerCase().includes(q)) return true;
      if (c.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [commands, query]);

  // Keyboard navigation inside palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex]!.action();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 backdrop-blur-sm p-4 pt-16 sm:pt-24 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border-3 border-[#1E293B] bg-white shadow-[10px_10px_0px_#1E293B] overflow-hidden dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[10px_10px_0px_#05070B] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Google Tri-color Accent Bar */}
        <div className="flex h-2 w-full">
          <div className="w-1/4 bg-[#4285F4]" />
          <div className="w-1/4 bg-[#EA4335]" />
          <div className="w-1/4 bg-[#FBBC04]" />
          <div className="w-1/4 bg-[#34A853]" />
        </div>

        {/* Input Header */}
        <div className="relative flex items-center border-b-2 border-slate-200 px-4 py-3 dark:border-slate-800">
          <Search className="h-5 w-5 text-slate-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command, site, page, or action…"
            className="w-full bg-transparent font-mono text-sm font-bold text-[#0F172A] placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-slate-400 hover:text-[#0F172A] dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              ESC to exit
            </kbd>
          )}
        </div>

        {/* Command Items List */}
        <ul ref={listRef} className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-100 dark:divide-slate-800/60">
          {filtered.length === 0 ? (
            <li className="py-12 text-center">
              <Command className="mx-auto h-8 w-8 text-slate-400 mb-2" />
              <p className="font-['Outfit',sans-serif] text-sm font-bold text-[#0F172A] dark:text-white">
                No matching commands
              </p>
              <p className="font-mono text-xs text-slate-400">Try searching for "inventory", "scan", or "theme"</p>
            </li>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = selectedIndex === idx;
              const Icon = item.icon;

              return (
                <li
                  key={item.id}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[#FBBC04]/20 border-2 border-[#1E293B] shadow-[2px_2px_0px_#1E293B] dark:border-[#FBBC04] dark:bg-[#FBBC04]/10"
                      : "border-2 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg border-2 border-[#1E293B] shrink-0 ${
                        isSelected
                          ? "bg-[#FBBC04] text-[#0F172A]"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-['Outfit',sans-serif] text-sm font-bold text-[#0F172A] truncate dark:text-white">
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="font-mono text-[11px] text-slate-500 truncate dark:text-slate-400">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      {item.category}
                    </span>
                    {item.shortcut ? (
                      <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {item.shortcut}
                      </kbd>
                    ) : (
                      isSelected && <ArrowRight className="h-4 w-4 text-[#FBBC04]" />
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {/* Footer shortcuts info */}
        <div className="flex items-center justify-between border-t-2 border-slate-200 bg-slate-50 px-4 py-2 font-mono text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-bold">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-bold">↵</kbd> select
            </span>
            <span>
              <kbd className="font-bold">esc</kbd> close
            </span>
          </div>
          <span className="font-bold text-[#2563EB] dark:text-[#FBBC04]">NAVI OPERATIONS COMMAND</span>
        </div>
      </div>
    </div>
  );
}
