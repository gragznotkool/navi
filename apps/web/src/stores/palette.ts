import { create } from "zustand";

export interface PaletteCommand {
  id: string;
  label: string;
  group: "Go to" | "Switch site" | "Actions";
  /** Extra words that should match the search but are not shown. */
  keywords?: string;
  /** A route to open, or an action to run (exactly one). */
  to?: string;
  run?: () => void | Promise<void>;
}

interface PaletteState {
  open: boolean;
  /** Commands for the site the user is currently inside; registered by the site shell. */
  siteCommands: PaletteCommand[];
  setOpen: (open: boolean) => void;
  setSiteCommands: (commands: PaletteCommand[]) => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  siteCommands: [],
  setOpen: (open) => set({ open }),
  setSiteCommands: (siteCommands) => set({ siteCommands }),
}));
