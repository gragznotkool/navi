import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { notify } from "../../stores/toast";
import { usePalette, type PaletteCommand } from "../../stores/palette";
import { useSession } from "../../stores/session";
import { searchCommands } from "./search";

/** Commands that exist everywhere; site-specific ones are added by the site shell. */
function useGlobalCommands(): PaletteCommand[] {
  const session = useSession((s) => s.session);
  const logout = useSession((s) => s.logout);
  const navigate = useNavigate();
  return useMemo(() => {
    const list: PaletteCommand[] = [
      { id: "hub", label: "Hub: your sites", group: "Go to", keywords: "home start", to: "/hub/sites" },
      { id: "hub-builder", label: "Hub: configuration builder", group: "Go to", keywords: "configure edit modules", to: "/hub/builder" },
    ];
    if (session?.user.isPlatformAdmin) {
      list.push({ id: "trust", label: "Trust console", group: "Go to", keywords: "security proofs isolation", to: "/trust" });
      list.push({ id: "new-site", label: "Create a new site", group: "Actions", keywords: "provision add", to: "/sites/new" });
    }
    for (const m of session?.memberships ?? []) {
      list.push({ id: `site:${m.siteSlug}`, label: `Switch to ${m.siteSlug}`, group: "Switch site", keywords: `open ${m.roles.join(" ")}`, to: `/s/${m.siteSlug}` });
      if (m.permissions.includes("config:manage")) {
        list.push({ id: `builder:${m.siteSlug}`, label: `Open builder for ${m.siteSlug}`, group: "Go to", keywords: "configuration", to: `/s/${m.siteSlug}/admin/builder` });
      }
    }
    list.push({
      id: "sign-out",
      label: "Sign out",
      group: "Actions",
      keywords: "log out",
      run: async () => {
        await logout();
        navigate("/login");
      },
    });
    return list;
  }, [session, logout, navigate]);
}

/** Ctrl+K (or Cmd+K) command palette: navigation, site switching and actions, fully keyboard driven. */
export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.setOpen);
  const siteCommands = usePalette((s) => s.siteCommands);
  const status = useSession((s) => s.status);
  const navigate = useNavigate();
  const location = useLocation();
  const global = useGlobalCommands();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // From any page, including while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (useSession.getState().status !== "authenticated") return;
        const next = !usePalette.getState().open;
        if (next) opener.current = document.activeElement as HTMLElement | null;
        setOpen(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // Close on navigation and on sign-out.
  useEffect(() => setOpen(false), [location.pathname, setOpen]);
  useEffect(() => {
    if (status !== "authenticated") setOpen(false);
  }, [status, setOpen]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      input.current?.focus();
    } else {
      opener.current?.focus?.();
    }
  }, [open]);

  const results = useMemo(() => searchCommands([...siteCommands, ...global], query), [siteCommands, global, query]);
  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const run = async (c: PaletteCommand) => {
    setOpen(false);
    try {
      if (c.to) navigate(c.to);
      else await c.run?.();
    } catch {
      notify.error("That command could not be completed.");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = results.length;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (n === 0 ? 0 : (i + 1) % n));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (n === 0 ? 0 : (i - 1 + n) % n));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = results[active];
      if (c) void run(c);
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus stays in the palette; the list is driven from the input
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-lg overflow-hidden rounded-ui border border-line bg-surface shadow-xl">
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          aria-label="Search commands"
          autoComplete="off"
          placeholder="Type a command or a site…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul id="palette-list" role="listbox" aria-label="Commands" className="max-h-80 overflow-auto py-1">
          {results.length === 0 && <li role="presentation" className="px-4 py-3 text-sm text-muted">No matching commands.</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && query === "" && <p className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted">{header}</p>}
                <div
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => void run(c)}
                  className={`cursor-pointer px-4 py-2 text-sm ${i === active ? "bg-accent text-white" : "text-ink"}`}
                >
                  {c.label}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-4 py-1.5 text-xs text-muted">Up/Down to move · Enter to run · Esc to close</p>
      </div>
    </div>
  );
}
