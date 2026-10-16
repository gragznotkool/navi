import { create } from "zustand";
import type { SiteConfiguration } from "@opshub/contracts";

/** Holds server-validated draft configurations for preview. Never persisted and never published from here. */
interface PreviewState {
  drafts: Record<string, SiteConfiguration>;
  getDraft: (siteKey: string) => SiteConfiguration | undefined;
  setDraft: (slug: string, config: SiteConfiguration) => void;
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  drafts: {},
  getDraft: (siteKey) => get().drafts[siteKey],
  setDraft: (slug, config) => set((s) => ({ drafts: { ...s.drafts, [slug]: config } })),
}));
