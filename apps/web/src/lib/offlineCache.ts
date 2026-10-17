// IndexedDB cache utilities for Dead‑Zone Lite
// Uses the `idb` wrapper (added to package.json).
// All cached records are scoped to a specific authenticated user
// and site to avoid cross‑tenant leakage.

import { openDB, IDBPDatabase } from "idb";

/**
 * Cache schema – one object store per data category.
 * The store key is a composite `${siteId}:${userId}:${recordId}`
 * (or `${siteId}:${userId}` for collection‑level metadata).
 */
export interface CacheEntry<T> {
  /** ISO timestamp when the record was cached */
  cachedAt: string;
  /** The actual payload */
  data: T;
}

// Types for the data we cache – reuse contracts where possible.
import type {
  StockItem,
  RequestRecord,
  Assignment,
} from "@opshub/contracts";

let dbPromise: Promise<IDBPDatabase<any>> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDB("opshub-offline-cache", 1, {
      upgrade(db) {
        db.createObjectStore("inventory", { keyPath: "key" });
        db.createObjectStore("requests", { keyPath: "key" });
        db.createObjectStore("assignments", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

function makeKey(siteId: string, userId: string, id?: string) {
  return id ? `${siteId}:${userId}:${id}` : `${siteId}:${userId}`;
}

/** Store a single record (or collection) */
export async function setCache<T>(
  store: string,
  siteId: string,
  userId: string,
  id: string | undefined,
  data: T,
): Promise<void> {
  const db = await getDb();
  const entry: CacheEntry<T> = { cachedAt: new Date().toISOString(), data };
  await db.put(store, { ...entry, key: makeKey(siteId, userId, id) });
}

/** Retrieve a cached record; returns undefined if missing */
export async function getCache<T>(
  store: string,
  siteId: string,
  userId: string,
  id: string | undefined,
): Promise<CacheEntry<T> | undefined> {
  const db = await getDb();
  return await db.get(store, makeKey(siteId, userId, id));
}

/** Retrieve all cached records for a store (used for list pages) */
export async function getAllCache<T>(
  store: string,
  siteId: string,
  userId: string,
): Promise<CacheEntry<T>[]> {
  const db = await getDb();
  const all = await db.getAll(store);
  const prefix = `${siteId}:${userId}`;
  return all.filter((e: any) => e.key.startsWith(prefix)) as CacheEntry<T>[];
}

/** Clear all data for a specific user/site – called on logout or session change */
export async function clearCache(siteId: string, userId: string): Promise<void> {
  const db = await getDb();
  for (const store of ["inventory", "requests", "assignments"]) {
    const tx = db.transaction(store, "readwrite");
    const all = await tx.store.getAll();
    for (const entry of all) {
      if ((entry.key as string).startsWith(`${siteId}:${userId}`)) {
        await tx.store.delete(entry.key);
      }
    }
    await tx.done;
  }
}

/** Utility to wrap an API call – on success it caches the result */
export async function fetchAndCache<T>(
  store: string,
  siteId: string,
  userId: string,
  id: string | undefined,
  apiCall: () => Promise<T>,
): Promise<T> {
  const data = await apiCall();
  await setCache(store, siteId, userId, id, data);
  return data;
}

/** Helper to read from cache when offline */
export async function readFromCache<T>(
  store: string,
  siteId: string,
  userId: string,
  id: string | undefined,
): Promise<T | undefined> {
  const entry = await getCache<T>(store, siteId, userId, id);
  return entry?.data;
}
