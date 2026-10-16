const KEY = "opshub.lastSite";

/** Remembers the last site slug opened in this browser. Purely a convenience: every read/write may fail. */
export function getLastSite(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setLastSite(slug: string): void {
  try {
    window.localStorage.setItem(KEY, slug);
  } catch {
    // storage unavailable (private mode, blocked): the feature just does nothing
  }
}
export function clearLastSite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
