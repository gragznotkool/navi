import { create } from "zustand";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: "workflow" | "stock" | "alert" | "release";
  title: string;
  description: string;
  severity: "normal" | "warning" | "critical";
  actor: string;
  read: boolean;
}

interface ActivityState {
  events: ActivityEvent[];
  streaming: boolean;
  soundEnabled: boolean;
  addEvent: (event: Omit<ActivityEvent, "id" | "timestamp" | "read">) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  toggleStreaming: () => void;
  toggleSound: () => void;
}

const INITIAL_EVENTS: ActivityEvent[] = [
  {
    id: "evt-1",
    timestamp: new Date(Date.now() - 45000).toISOString(),
    category: "workflow",
    title: "Material Assignment Fulfilled",
    description: "Assigned 2x STM32F401 Microcontrollers for PCB repair intake #PCB-2026-X884",
    severity: "normal",
    actor: "storekeeper@opshub.local",
    read: false,
  },
  {
    id: "evt-2",
    timestamp: new Date(Date.now() - 120000).toISOString(),
    category: "alert",
    title: "SLA Warning Notice",
    description: "Request #RQ-942 pending approval at Central Stores for > 15 minutes",
    severity: "warning",
    actor: "System SLA Monitor",
    read: false,
  },
  {
    id: "evt-3",
    timestamp: new Date(Date.now() - 300000).toISOString(),
    category: "stock",
    title: "Reorder Threshold Breached",
    description: "Stock for 'Electrolytic Cap 450V' dropped to 8 units (Reorder level: 15)",
    severity: "critical",
    actor: "Inventory Ledger Trigger",
    read: false,
  },
  {
    id: "evt-4",
    timestamp: new Date(Date.now() - 600000).toISOString(),
    category: "release",
    title: "Release v3 Live Deployed",
    description: "Active configuration updated with enhanced PCB repair telemetry",
    severity: "normal",
    actor: "admin@opshub.local",
    read: true,
  },
];

const SIMULATED_STREAM_TEMPLATES: Omit<ActivityEvent, "id" | "timestamp" | "read">[] = [
  {
    category: "stock",
    title: "Optical Barcode Verified",
    description: "Physical audit verified 50x Fast Blow Fuses at Bin W-04",
    severity: "normal",
    actor: "technician@opshub.local",
  },
  {
    category: "workflow",
    title: "New Request Submitted",
    description: "Material request for 4x Omron 12V High-Current Relays submitted",
    severity: "normal",
    actor: "technician@opshub.local",
  },
  {
    category: "alert",
    title: "ESD Impedance Check Logged",
    description: "Workstation 4 passed IEC 61340 static grounding tolerance validation",
    severity: "normal",
    actor: "Safety Compliance Bot",
  },
  {
    category: "stock",
    title: "Component Restocked",
    description: "Return #RET-842 successfully restocked to main inventory (+2 units)",
    severity: "normal",
    actor: "storekeeper@opshub.local",
  },
];

export const useActivityStore = create<ActivityState>((set, get) => {
  // Setup simulated event ticker if in browser
  if (typeof window !== "undefined") {
    let index = 0;
    setInterval(() => {
      if (!get().streaming) return;
      const tpl = SIMULATED_STREAM_TEMPLATES[index % SIMULATED_STREAM_TEMPLATES.length]!;
      index++;
      get().addEvent(tpl);
    }, 40000);
  }

  return {
    events: INITIAL_EVENTS,
    streaming: true,
    soundEnabled: true,
    addEvent: (data) => {
      const newEvt: ActivityEvent = {
        ...data,
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        read: false,
      };
      set((state) => ({
        events: [newEvt, ...state.events].slice(0, 50),
      }));
    },
    markRead: (id) => {
      set((state) => ({
        events: state.events.map((e) => (e.id === id ? { ...e, read: true } : e)),
      }));
    },
    markAllRead: () => {
      set((state) => ({
        events: state.events.map((e) => ({ ...e, read: true })),
      }));
    },
    clearAll: () => {
      set({ events: [] });
    },
    toggleStreaming: () => {
      set((state) => ({ streaming: !state.streaming }));
    },
    toggleSound: () => {
      set((state) => ({ soundEnabled: !state.soundEnabled }));
    },
  };
});
