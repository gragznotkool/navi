/** Linear undo/redo buffer over immutable snapshots. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });

/** Records `next` as a new undoable step (clears redo). No-op when nothing changed by reference. */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

/** Replaces the present WITHOUT creating a step (the in-flight frames of a drag). */
export const replace = <T,>(h: History<T>, next: T): History<T> => ({ ...h, present: next });

/** Marks the current present as an undo point (called once when a drag starts). */
export function checkpoint<T>(h: History<T>): History<T> {
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}
