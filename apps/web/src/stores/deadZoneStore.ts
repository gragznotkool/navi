import { create } from "zustand";

const DB_NAME = "opshub_deadzone_lite";
const STORE_NAME = "cache_v1";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB is unavailable"));
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, val: T): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

interface DeadZoneState {
  isOffline: boolean;
  simulatedOffline: boolean;
  lastPingAt: number;
  cachedKeys: string[];
  setSimulatedOffline: (val: boolean) => void;
  recordCacheEntry: (key: string) => void;
  setOfflineStatus: (offline: boolean) => void;
}

export const useDeadZoneStore = create<DeadZoneState>((set, get) => ({
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
  simulatedOffline: false,
  lastPingAt: Date.now(),
  cachedKeys: [],

  setSimulatedOffline: (val: boolean) => {
    set({ simulatedOffline: val });
  },

  recordCacheEntry: (key: string) => {
    const keys = get().cachedKeys;
    if (!keys.includes(key)) {
      set({ cachedKeys: [...keys, key] });
    }
  },

  setOfflineStatus: (offline: boolean) => {
    set({ isOffline: offline, lastPingAt: Date.now() });
  },
}));

/**
 * Pre-warms IndexedDB cache with essential industrial configuration and schema data.
 */
export async function prewarmDeadZoneCache(siteSlug: string, siteConfig: any) {
  if (!siteSlug || !siteConfig) return;
  const key = `site:${siteSlug}:config`;
  await idbSet(key, {
    cachedAt: new Date().toISOString(),
    config: siteConfig,
    appVersion: "1.0.0-electrolyte",
    clientUnit: "Electrolyte Solutions ISO 9001:2015",
  });
  useDeadZoneStore.getState().recordCacheEntry(key);
}
