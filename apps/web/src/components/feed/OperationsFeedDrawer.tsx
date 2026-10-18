import { useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCheck,
  ClipboardList,
  GitBranch,
  Play,
  Pause,
  Radio,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { useActivityStore, type ActivityEvent } from "../../stores/activityFeed";
import { Button } from "../ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function OperationsFeedDrawer({ isOpen, onClose }: Props) {
  const { events, streaming, soundEnabled, markAllRead, clearAll, toggleStreaming, toggleSound, addEvent } =
    useActivityStore();
  const [filter, setFilter] = useState<"all" | "alert" | "stock" | "workflow">("all");

  if (!isOpen) return null;

  const filtered = events.filter((e) => {
    if (filter === "all") return true;
    return e.category === filter;
  });

  const getIcon = (cat: ActivityEvent["category"]) => {
    switch (cat) {
      case "alert":
        return <AlertTriangle className="h-4 w-4 text-[#EA4335]" />;
      case "stock":
        return <Boxes className="h-4 w-4 text-[#FBBC04]" />;
      case "workflow":
        return <ClipboardList className="h-4 w-4 text-[#4285F4]" />;
      case "release":
        return <GitBranch className="h-4 w-4 text-[#34A853]" />;
    }
  };

  const formatRelative = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 30) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const handleSimulateEvent = () => {
    addEvent({
      category: "alert",
      title: "Manual Test Alert",
      description: "High priority telemetry ping triggered by operator console",
      severity: "warning",
      actor: "operator@opshub.local",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200" onClick={onClose}>
      <aside
        className="w-full max-w-md h-full border-l-3 border-[#1E293B] bg-white flex flex-col shadow-[-8px_0px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:shadow-[-8px_0px_0px_#05070B] animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Radar Top Header */}
        <div className="flex items-center justify-between border-b-2 border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              {streaming && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${streaming ? "bg-emerald-500" : "bg-slate-400"}`} />
            </span>
            <div>
              <h2 className="font-['Outfit',sans-serif] text-base font-black uppercase tracking-wider text-[#0F172A] dark:text-white flex items-center gap-1.5">
                <Radio className="h-4 w-4 text-[#2563EB] dark:text-[#FBBC04]" /> Operations Radar
              </h2>
              <p className="font-mono text-[10px] text-slate-500">
                {streaming ? "REAL-TIME TELEMETRY FEED (ACTIVE)" : "STREAM PAUSED"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleStreaming}
              title={streaming ? "Pause stream" : "Resume stream"}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {streaming ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 text-emerald-600" />}
            </button>
            <button
              type="button"
              onClick={toggleSound}
              title={soundEnabled ? "Mute alert audio" : "Enable alert audio"}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-[#34A853]" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 hover:text-[#0F172A] dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Filter categories & actions */}
        <div className="flex items-center justify-between border-b-2 border-slate-200 px-4 py-2 bg-white dark:border-slate-800 dark:bg-[#131B2E]">
          <div className="flex items-center gap-1">
            {(["all", "alert", "stock", "workflow"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase transition ${
                  filter === cat
                    ? "bg-[#1E293B] text-white dark:bg-[#FBBC04] dark:text-[#0F172A]"
                    : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={markAllRead}
              title="Mark all as read"
              className="rounded p-1 text-slate-400 hover:text-[#0F172A] dark:hover:text-white"
            >
              <CheckCheck className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={clearAll}
              title="Clear all events"
              className="rounded p-1 text-slate-400 hover:text-[#EA4335]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Event Cards List */}
        <ul className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.length === 0 ? (
            <li className="py-16 text-center">
              <Radio className="mx-auto h-8 w-8 text-slate-400 mb-2 opacity-50" />
              <p className="font-['Outfit',sans-serif] text-sm font-bold text-[#0F172A] dark:text-white">
                Radar quiescent
              </p>
              <p className="font-mono text-xs text-slate-500">No events in this category yet</p>
            </li>
          ) : (
            filtered.map((item) => {
              const borderAccent =
                item.severity === "critical"
                  ? "border-l-4 border-l-[#EA4335]"
                  : item.severity === "warning"
                    ? "border-l-4 border-l-[#FBBC04]"
                    : "border-l-4 border-l-[#4285F4]";

              return (
                <li
                  key={item.id}
                  className={`rounded-xl border-2 border-[#1E293B] bg-white p-3 shadow-[3px_3px_0px_#1E293B] dark:border-[#334155] dark:bg-[#1A243B] dark:shadow-[3px_3px_0px_#05070B] ${borderAccent} transition hover:-translate-y-0.5`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded border border-slate-300 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
                        {getIcon(item.category)}
                      </div>
                      <span className="font-['Outfit',sans-serif] text-xs font-bold text-[#0F172A] dark:text-white">
                        {item.title}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {formatRelative(item.timestamp)}
                    </span>
                  </div>

                  <p className="mt-1.5 font-medium text-xs text-slate-600 dark:text-slate-300">
                    {item.description}
                  </p>

                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400 dark:border-slate-800">
                    <span className="truncate">{item.actor}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {item.category}
                    </span>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {/* Drawer Footer with Simulator Button */}
        <div className="border-t-2 border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60 flex items-center justify-between">
          <Button variant="secondary" onClick={handleSimulateEvent} className="h-8 gap-1.5 text-xs">
            <Zap className="h-3.5 w-3.5 text-[#FBBC04]" /> Ping Test Event
          </Button>
          <span className="font-mono text-[10px] font-bold text-slate-500">
            {events.length} events logged
          </span>
        </div>
      </aside>
    </div>
  );
}
