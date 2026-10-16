import { create } from "zustand";

interface OfflineState {
  /** Changes saved on this device and not yet accepted by the server. */
  pending: number;
  /** Changes the server refused; they stay visible until dismissed. */
  rejected: number;
  syncing: boolean;
  /** Set while screens are being served from the on-device copy instead of the server. */
  staleSince: string | null;
}

export const useOffline = create<OfflineState>(() => ({ pending: 0, rejected: 0, syncing: false, staleSince: null }));
