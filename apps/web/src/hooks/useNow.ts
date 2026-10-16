import { useSyncExternalStore } from "react";

// One shared timer for every countdown on the page, started with the first subscriber and stopped with the last.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time in ms, re-rendering the caller once per second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}
