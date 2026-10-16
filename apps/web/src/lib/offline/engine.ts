import type { SyncResponse, SyncResult } from "@opshub/contracts";
import { useOffline } from "../../stores/offline";
import { call, http, toRequestError } from "../api";
import { getStore, type OutboxItem, type OutboxType } from "./store";

// The session store registers itself here, which keeps this module free of a circular import.
let currentUserId: () => string | null = () => null;
export function setUserIdProvider(fn: () => string | null): void {
  currentUserId = fn;
}

const isNetworkFailure = (e: unknown): boolean => {
  const err = toRequestError(e);
  return err.status === 0 && err.code === "network";
};
export { isNetworkFailure };

// ------------------------------------------------------------------ read cache (stale-while-offline)

/**
 * Runs a read. On success the answer is copied to the device; when the server cannot be reached the last copy
 * for THIS user and site is returned instead (and the UI is told it is showing saved data). Errors other than
 * "cannot reach the server" are never masked: a 403 or 500 is always shown as such.
 */
export async function cachedRead<T>(siteId: string, name: string, read: () => Promise<T>): Promise<T> {
  const userId = currentUserId();
  const key = `${userId}|${siteId}|${name}`;
  try {
    const value = await read();
    if (userId) void getStore().putCache({ key, userId, value, savedAt: new Date().toISOString() }).catch(() => undefined);
    if (useOffline.getState().staleSince) useOffline.setState({ staleSince: null });
    return value;
  } catch (e) {
    if (userId && isNetworkFailure(e)) {
      const hit = await getStore().getCache(key).catch(() => undefined);
      if (hit && hit.userId === userId) {
        useOffline.setState({ staleSince: hit.savedAt });
        return hit.value as T;
      }
    }
    throw e;
  }
}

// ------------------------------------------------------------------ outbox

export async function refreshCounts(): Promise<void> {
  const userId = currentUserId();
  const items = userId ? await getStore().listOutbox(userId) : [];
  useOffline.setState({ pending: items.filter((i) => i.state === "pending").length, rejected: items.filter((i) => i.state === "rejected").length });
}

export async function listOutbox(siteId: string): Promise<OutboxItem[]> {
  const userId = currentUserId();
  if (!userId) return [];
  return (await getStore().listOutbox(userId)).filter((i) => i.siteId === siteId);
}

/** Saves a safe operation on the device. It is sent by `syncNow` as soon as the server can be reached. */
export async function enqueue(siteId: string, type: OutboxType, payload: unknown, label: string): Promise<OutboxItem | null> {
  const userId = currentUserId();
  if (!userId) return null;
  const item: OutboxItem = { id: crypto.randomUUID(), userId, siteId, type, payload, label, createdAt: new Date().toISOString(), state: "pending" };
  await getStore().addOutbox(item);
  await refreshCounts();
  return item;
}

export async function dismiss(id: string): Promise<void> {
  await getStore().removeOutbox(id);
  await refreshCounts();
}

/** Puts a rejected item back in the queue (for example after the cause was fixed on the server). */
export async function retry(id: string): Promise<void> {
  await getStore().updateOutbox(id, { state: "pending" });
  await refreshCounts();
}

export const SYNCED_EVENT = "opshub:synced";

let inflight: Promise<number> | null = null;

/**
 * Sends everything pending for the signed-in user, one site at a time. Single-flight: concurrent callers share the
 * same run. Returns how many operations the server accepted. A network failure leaves the queue untouched.
 */
export function syncNow(): Promise<number> {
  inflight ??= run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(): Promise<number> {
  const userId = currentUserId();
  if (!userId) return 0;
  const pending = (await getStore().listOutbox(userId)).filter((i) => i.state === "pending");
  if (pending.length === 0) return 0;
  useOffline.setState({ syncing: true });
  let accepted = 0;
  try {
    const bySite = new Map<string, OutboxItem[]>();
    for (const i of pending) bySite.set(i.siteId, [...(bySite.get(i.siteId) ?? []), i]);
    for (const [siteId, items] of bySite) {
      for (let at = 0; at < items.length; at += 50) {
        const batch = items.slice(at, at + 50);
        let results: SyncResult[];
        try {
          results = (await call<SyncResponse>(http.post(`/sites/${siteId}/sync`, { ops: batch.map((i) => ({ key: i.id, type: i.type, payload: i.payload })) }))).results;
        } catch (e) {
          if (isNetworkFailure(e)) return accepted; // still offline: keep everything
          const err = toRequestError(e);
          if (err.status === 404 || err.status === 403) {
            // The user lost access to this site: surface it instead of retrying forever.
            for (const i of batch) await getStore().updateOutbox(i.id, { state: "rejected", code: "forbidden", reason: "You no longer have access to this site." });
            continue;
          }
          return accepted; // 5xx or an expired session the interceptor could not renew: try again later
        }
        const byKey = new Map(results.map((r) => [r.key, r]));
        for (const i of batch) {
          const r = byKey.get(i.id);
          if (!r) continue;
          if (r.status === "rejected") await getStore().updateOutbox(i.id, { state: "rejected", ...(r.code ? { code: r.code } : {}), ...(r.reason ? { reason: r.reason } : {}) });
          else {
            await getStore().removeOutbox(i.id);
            accepted++;
          }
        }
      }
    }
    return accepted;
  } finally {
    useOffline.setState({ syncing: false });
    await refreshCounts();
    if (accepted > 0 && typeof window !== "undefined") window.dispatchEvent(new Event(SYNCED_EVENT));
  }
}

/** Removes everything this device holds for the user: the read cache and the queue. Called on sign-out. */
export async function clearOffline(): Promise<void> {
  const userId = currentUserId();
  if (userId) await getStore().clearUser(userId).catch(() => undefined);
  useOffline.setState({ pending: 0, rejected: 0, syncing: false, staleSince: null });
}

/** Starts background syncing: on reconnect, on start-up, and every 30 s while something is waiting. Returns a stop function. */
export function startOfflineSync(): () => void {
  const kick = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void refreshCounts().then(() => syncNow()).catch(() => undefined);
  };
  window.addEventListener("online", kick);
  const timer = setInterval(() => {
    if (useOffline.getState().pending > 0) kick();
  }, 30_000);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    clearInterval(timer);
  };
}
