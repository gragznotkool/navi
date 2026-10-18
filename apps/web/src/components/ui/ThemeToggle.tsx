import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "../../stores/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useThemeStore();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#1E293B] bg-white font-mono text-xs font-bold text-[#0F172A] shadow-[2px_2px_0px_#1E293B] transition-transform hover:-translate-y-0.5 active:translate-y-0.5 dark:border-[#334155] dark:bg-[#1E293B] dark:text-[#FBBC04] dark:shadow-[2px_2px_0px_#05070B] ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-[#FBBC04] transition-transform rotate-0 scale-100" />
      ) : (
        <Moon className="h-4 w-4 text-[#1E293B] transition-transform rotate-0 scale-100" />
      )}
    </button>
  );
}
