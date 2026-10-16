import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Operations a device may queue. Anything that moves stock is deliberately not here. */
export type OutboxType = "request.create" | "consumption.record";

export interface OutboxItem {
  /** Local id; also used as the idempotency key sent to the server. */
  id: string;
  userId: string;
  siteId: string;
  type: OutboxType;
  payload: unknown;
  /** Plain-English description shown in the "waiting to send" list. */
  label: string;
  createdAt: string;
  state: "pending" | "rejected";
  /** Server's reason when rejected. */
  code?: string;
  reason?: string;
}

export interface CacheEntry {
  key: string;
  userId: string;
  value: unknown;
  savedAt: string;
}

/** Everything the offline feature persists. A cache is per user; the outbox is per user and per site. */
export interface OfflineStore {
  getCache(key: string): Promise<CacheEntry | undefined>;
  putCache(entry: CacheEntry): Promise<void>;
  addOutbox(item: OutboxItem): Promise<void>;
  listOutbox(userId: string): Promise<OutboxItem[]>;
  updateOutbox(id: string, patch: Partial<OutboxItem>): Promise<void>;
  removeOutbox(id: string): Promise<void>;
  /** Removes the read cache AND the queue of one user (used on sign-out). */
  clearUser(userId: string): Promise<void>;
}

export function memoryStore(): OfflineStore {
  const cache = new Map<string, CacheEntry>();
  const outbox = new Map<string, OutboxItem>();
  return {
    async getCache(key) {
      return cache.get(key);
    },
    async putCache(entry) {
      cache.set(entry.key, entry);
    },
    async addOutbox(item) {
      outbox.set(item.id, item);
    },
    async listOutbox(userId) {
      return [...outbox.values()].filter((o) => o.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async updateOutbox(id, patch) {
      const cur = outbox.get(id);
      if (cur) outbox.set(id, { ...cur, ...patch });
    },
    async removeOutbox(id) {
      outbox.delete(id);
    },
    async clearUser(userId) {
      for (const [k, v] of cache) if (v.userId === userId) cache.delete(k);
      for (const [k, v] of outbox) if (v.userId === userId) outbox.delete(k);
    },
  };
}

interface Schema extends DBSchema {
  cache: { key: string; value: CacheEntry; indexes: { userId: string } };
  outbox: { key: string; value: OutboxItem; indexes: { userId: string } };
}

export function idbStore(): OfflineStore {
  let db: Promise<IDBPDatabase<Schema>> | null = null;
  const open = () =>
    (db ??= openDB<Schema>("opshub-offline", 1, {
      upgrade(d) {
        d.createObjectStore("cache", { keyPath: "key" }).createIndex("userId", "userId");
        d.createObjectStore("outbox", { keyPath: "id" }).createIndex("userId", "userId");
      },
    }));
  return {
    async getCache(key) {
      return (await open()).get("cache", key);
    },
    async putCache(entry) {
      await (await open()).put("cache", entry);
    },
    async addOutbox(item) {
      await (await open()).put("outbox", item);
    },
    async listOutbox(userId) {
      return (await (await open()).getAllFromIndex("outbox", "userId", userId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async updateOutbox(id, patch) {
      const d = await open();
      const tx = d.transaction("outbox", "readwrite");
      const cur = await tx.store.get(id);
      if (cur) await tx.store.put({ ...cur, ...patch });
      await tx.done;
    },
    async removeOutbox(id) {
      await (await open()).delete("outbox", id);
    },
    async clearUser(userId) {
      const d = await open();
      const tx = d.transaction(["cache", "outbox"], "readwrite");
      for (const name of ["cache", "outbox"] as const) {
        let cursor = await tx.objectStore(name).index("userId").openCursor(userId);
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      }
      await tx.done;
    },
  };
}

let store: OfflineStore | null = null;

/** IndexedDB in browsers; an in-memory store where it does not exist (tests, very old browsers, some private modes). */
export function getStore(): OfflineStore {
  if (store) return store;
  try {
    store = typeof indexedDB !== "undefined" ? idbStore() : memoryStore();
  } catch {
    store = memoryStore();
  }
  return store;
}

export function setStoreForTests(s: OfflineStore | null): void {
  store = s;
}
