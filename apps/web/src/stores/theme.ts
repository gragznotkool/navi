import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  resolvedTheme: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const body = document.body;
  if (theme === "dark") {
    root.classList.add("dark");
    body.classList.add("dark");
  } else {
    root.classList.remove("dark");
    body.classList.remove("dark");
  }
}

const STORAGE_KEY = "opshub-theme-mode";

const initialMode: ThemeMode = (() => {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored && ["light", "dark", "system"].includes(stored)) return stored;
  } catch {
    // ignore
  }
  return "light";
})();

const initialResolved = initialMode === "system" ? getSystemTheme() : initialMode;
applyTheme(initialResolved);

export const useThemeStore = create<ThemeState>((set, get) => {
  // Listen for system theme changes if mode is system
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        if (get().mode === "system") {
          const next = e.matches ? "dark" : "light";
          applyTheme(next);
          set({ resolvedTheme: next });
        }
      });
    } catch {
      // ignore
    }
  }

  return {
    mode: initialMode,
    resolvedTheme: initialResolved,
    setMode: (mode: ThemeMode) => {
      localStorage.setItem(STORAGE_KEY, mode);
      const resolved = mode === "system" ? getSystemTheme() : mode;
      applyTheme(resolved);
      set({ mode, resolvedTheme: resolved });
    },
    toggleTheme: () => {
      const current = get().resolvedTheme;
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      set({ mode: next, resolvedTheme: next });
    },
  };
});
