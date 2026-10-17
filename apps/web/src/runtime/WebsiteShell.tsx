import "../styles/website.css";
import { LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, PencilRuler, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { WebsiteTheme } from "@opshub/contracts";
import { OfflineBanner } from "../components/feedback";
import { themeAttrs, themeVars } from "../features/builder/website-builder/themes";
import { useSession } from "../stores/session";
import { useSiteRuntime } from "./context";
import { moduleIcons } from "./SiteShell";
import { buildAdapterCss } from "./websiteAdapterCss";

let adapterInjected = false;
/** The palette adapter is the same for every website (it only points at tokens), so inject it once. */
function ensureAdapterCss() {
  if (adapterInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.dataset.opshub = "website-adapter";
  el.textContent = buildAdapterCss();
  document.head.appendChild(el);
  adapterInjected = true;
}

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
}

function useWebsiteNav(): NavEntry[] {
  const { config, permissions, basePath } = useSiteRuntime();
  return config.navigation.flatMap((n) => {
    const page = config.pages.find((p) => p.id === n.pageId);
    if (!page) return [];
    if (page.requiredPermission && !permissions.has(page.requiredPermission)) return [];
    const node = config.modules.nodes.find((m) => m.id === page.nodeId);
    return [{ to: `${basePath}/${page.path}`, label: n.label, icon: (node && moduleIcons[node.moduleType]) || LayoutDashboard }];
  });
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function Brand({ compact = false }: { compact?: boolean }) {
  const { config, basePath } = useSiteRuntime();
  return (
    <Link to={basePath} className="flex min-w-0 items-center gap-2.5" title={config.name}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-sm font-bold" style={{ background: "var(--ws-primary)", color: "var(--ws-on-primary)", borderRadius: "var(--ws-radius)", fontFamily: "var(--ws-heading-font)" }}>
        {initials(config.name)}
      </span>
      {!compact && (
        <span className="truncate text-base font-semibold" style={{ fontFamily: "var(--ws-heading-font)", color: "var(--ws-text)" }}>
          {config.name}
        </span>
      )}
    </Link>
  );
}

function NavItem({ entry, theme, placement, collapsed = false }: { entry: NavEntry; theme: WebsiteTheme; placement: "left" | "top" | "bottom"; collapsed?: boolean }) {
  const Icon = entry.icon;
  const showIcon = collapsed || theme.navStyle !== "text-only" || placement === "bottom";
  const showText = placement === "bottom" || (placement === "left" ? !collapsed : theme.navStyle !== "icons-only");
  const base = "inline-flex items-center gap-2 text-sm font-medium transition-colors duration-150";
  const cls = {
    left: (a: boolean) => `${base} w-full px-3 py-2.5 ${collapsed ? "justify-center" : ""} ${a ? "font-semibold" : ""}`,
    top: (a: boolean) => `${base} h-full border-b-2 px-3 ${a ? "font-semibold" : "border-transparent"}`,
    bottom: (a: boolean) => `${base} flex-col !gap-0.5 px-3 py-1.5 text-[11px] ${a ? "font-semibold" : ""}`,
  }[placement];
  const style = (a: boolean): CSSProperties => {
    if (placement === "left") return { borderRadius: "var(--ws-radius)", background: a ? "var(--ws-primary-soft)" : undefined, color: a ? "var(--ws-secondary)" : "var(--ws-text-2)" };
    if (placement === "top") return { borderColor: a ? "var(--ws-primary)" : "transparent", color: a ? "var(--ws-secondary)" : "var(--ws-text-2)" };
    return { color: a ? "var(--ws-primary)" : "var(--ws-muted)" };
  };
  return (
    <NavLink to={entry.to} end title={entry.label} className={({ isActive }) => cls(isActive)} style={({ isActive }) => style(isActive)}>
      {showIcon && <Icon className={placement === "bottom" ? "h-5 w-5" : "h-4 w-4 shrink-0"} aria-hidden />}
      {showText ? <span className="truncate">{entry.label}</span> : <span className="sr-only">{entry.label}</span>}
    </NavLink>
  );
}

function UserChip({ compact = false }: { compact?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const name = session?.user.displayName ?? "";
  return (
    <div className={`flex items-center gap-2 ${compact ? "flex-col" : ""}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: "var(--ws-primary-soft)", color: "var(--ws-secondary)" }} title={name}>
        {initials(name)}
      </span>
      {!compact && <span className="hidden max-w-[10rem] truncate text-sm sm:inline" style={{ color: "var(--ws-text-2)" }}>{name}</span>}
      <button
        type="button"
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        aria-label="Sign out"
        title="Sign out"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-80"
        style={{ color: "var(--ws-muted)" }}
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/** Same switcher as the OpsHub shell, dressed in the website theme. /s/<slug> lands each site in its own design. */
function SiteSwitcher() {
  const session = useSession((s) => s.session);
  const { slug } = useSiteRuntime();
  const navigate = useNavigate();
  if (!session || session.memberships.length < 2) return null;
  return (
    <select
      aria-label="Switch site"
      value={slug}
      onChange={(e) => navigate(`/s/${e.target.value}`)}
      className="hidden h-8 max-w-[11rem] truncate px-2.5 text-xs font-medium sm:block"
      style={{ border: "1px solid var(--ws-border)", borderRadius: "var(--ws-btn-radius)", background: "var(--ws-surface)", color: "var(--ws-text-2)" }}
    >
      {session.memberships.map((m) => (
        <option key={m.siteId} value={m.siteSlug}>{m.siteSlug}</option>
      ))}
    </select>
  );
}

function AdminLink() {
  const { permissions, slug } = useSiteRuntime();
  if (!permissions.has("config:manage")) return null;
  return (
    <Link to={`/s/${slug}/admin/builder`} className="hidden items-center gap-1.5 px-3 py-1.5 text-xs font-medium md:inline-flex" style={{ border: "1px solid var(--ws-border)", borderRadius: "var(--ws-btn-radius)", color: "var(--ws-text-2)", background: "var(--ws-surface)" }}>
      <PencilRuler className="h-3.5 w-3.5" aria-hidden /> Edit in OpsHub
    </Link>
  );
}

function HeaderBand({ theme, title }: { theme: WebsiteTheme; title: string }) {
  const { config, version, slug } = useSiteRuntime();
  const session = useSession((s) => s.session);
  const role = session?.memberships.find((m) => m.siteSlug === slug)?.roles.join(", ") || "Member";
  const first = session?.user.displayName.split(" ")[0] ?? "";

  if (theme.headerStyle === "hero") {
    return (
      <div className="relative mb-6 overflow-hidden px-6 py-8 sm:px-8" style={{ background: "var(--ws-primary)", color: "var(--ws-on-primary)", borderRadius: "var(--ws-radius)" }}>
        <span aria-hidden className="absolute -right-10 -top-16 h-48 w-48 rounded-full" style={{ background: "var(--ws-on-primary)", opacity: 0.12 }} />
        <span aria-hidden className="absolute -bottom-20 right-24 h-40 w-40 rounded-full" style={{ background: "var(--ws-accent)", opacity: 0.35 }} />
        <p className="relative text-sm font-medium opacity-90">Welcome back{first ? `, ${first}` : ""}</p>
        <h1 className="relative mt-1 text-3xl font-bold" style={{ color: "inherit" }}>{title}</h1>
        <p className="relative mt-1 text-sm opacity-80">{config.name}</p>
      </div>
    );
  }
  if (theme.headerStyle === "centered") {
    return (
      <div className="mb-8 text-center">
        <p className="ws-caps text-xs font-semibold" style={{ color: "var(--ws-primary)" }}>{config.name}</p>
        <h1 className="mt-2 text-3xl font-bold" style={{ color: "var(--ws-text)" }}>{title}</h1>
        <span aria-hidden className="mx-auto mt-3 block h-1 w-12 rounded-full" style={{ background: "var(--ws-primary)" }} />
      </div>
    );
  }
  if (theme.headerStyle === "split") {
    return (
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 pb-4" style={{ borderBottom: "1px solid var(--ws-border)" }}>
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--ws-muted)" }}>{config.name}</p>
          <h1 className="mt-0.5 text-2xl font-bold" style={{ color: "var(--ws-text)" }}>{title}</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 font-medium" style={{ background: "var(--ws-primary-soft)", color: "var(--ws-secondary)", borderRadius: "var(--ws-btn-radius)" }}>{role}</span>
          <span className="px-2.5 py-1" style={{ border: "1px solid var(--ws-border)", color: "var(--ws-text-2)", borderRadius: "var(--ws-btn-radius)" }}>Release v{version ?? "—"}</span>
        </div>
      </div>
    );
  }
  return (
    <p className="mb-4 text-xs" style={{ color: "var(--ws-muted)" }}>
      {config.name} <span aria-hidden>/</span> <span style={{ color: "var(--ws-text)" }}>{title}</span>
    </p>
  );
}

function Footer() {
  return (
    <footer className="mt-10 pb-2 text-center text-xs" style={{ color: "var(--ws-muted)" }}>
      Built with <Link to="/" className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--ws-text-2)" }}>OpsHub</Link>
    </footer>
  );
}

/**
 * Whether the left sidebar is minimized. Starts from the theme (icons-only themes start narrow) and
 * remembers the visitor's choice per website in this browser.
 */
function useSidebarCollapsed(slug: string, initial: boolean): [boolean, () => void] {
  const key = `opshub:website-nav-collapsed:${slug}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(key, c ? "0" : "1");
      } catch {
        /* storage unavailable: the choice lasts for this visit only */
      }
      return !c;
    });
  return [collapsed, toggle];
}

/**
 * The shell of a deployed website. Navigation placement, header, typography, density and component
 * variants all come from the website theme in the active configuration; nothing branches on the site.
 */
export function WebsiteShell({ theme, title, children }: { theme: WebsiteTheme; title: string; children: ReactNode }) {
  ensureAdapterCss();
  const { config, version, slug } = useSiteRuntime();
  const nav = useWebsiteNav();
  const [iconsOnly, toggleSidebar] = useSidebarCollapsed(slug, theme.navStyle === "icons-only");

  const content = (
    <div className="ws-fade-up mx-auto w-full max-w-7xl" key={title}>
      <HeaderBand theme={theme} title={title} />
      {children}
      <Footer />
    </div>
  );
  const blobs = theme.cardStyle === "glassmorphic" && (
    <>
      <span aria-hidden className="ws-blob -left-24 top-24 h-80 w-80" style={{ background: "var(--ws-primary)" }} />
      <span aria-hidden className="ws-blob right-0 top-1/3 h-96 w-96" style={{ background: "var(--ws-accent)" }} />
      <span aria-hidden className="ws-blob bottom-0 left-1/3 h-72 w-72" style={{ background: "var(--ws-secondary)", opacity: 0.2 }} />
    </>
  );
  const rootProps = { ...themeAttrs(theme), style: themeVars(theme), "data-shell": config.shell } as const;
  const surfaceBar: CSSProperties = { background: theme.cardStyle === "glassmorphic" ? "color-mix(in srgb, var(--ws-surface) 70%, transparent)" : "var(--ws-surface)", borderColor: "var(--ws-border)", backdropFilter: theme.cardStyle === "glassmorphic" ? "blur(16px)" : undefined };

  if (theme.navPosition === "left") {
    return (
      <div {...rootProps} className="relative flex h-full flex-col overflow-hidden">
        <OfflineBanner />
        {blobs}
        <div className="relative flex min-h-0 flex-1">
          <aside aria-label="Sidebar" data-collapsed={iconsOnly} className={`flex shrink-0 flex-col gap-4 overflow-hidden border-r p-3 transition-[width] duration-200 ease-out ${iconsOnly ? "w-[76px] items-center" : "w-64"}`} style={surfaceBar}>
            <div className={`px-1 py-2 ${iconsOnly ? "" : "w-full"}`}>
              <Brand compact={iconsOnly} />
            </div>
            <nav aria-label="Main" className="flex w-full flex-col gap-1">
              {nav.map((e) => <NavItem key={e.to} entry={e} theme={theme} placement="left" collapsed={iconsOnly} />)}
            </nav>
            <div className="mt-auto w-full border-t pt-3" style={{ borderColor: "var(--ws-border)" }}>
              <UserChip compact={iconsOnly} />
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-6" style={surfaceBar}>
              <span className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSidebar}
                  aria-label={iconsOnly ? "Expand sidebar" : "Minimize sidebar"}
                  aria-expanded={!iconsOnly}
                  title={iconsOnly ? "Expand sidebar" : "Minimize sidebar"}
                  className="-ml-2 inline-flex h-9 w-9 shrink-0 items-center justify-center transition-colors hover:opacity-80"
                  style={{ color: "var(--ws-text-2)", borderRadius: "var(--ws-btn-radius)", background: "var(--ws-surface-2)" }}
                >
                  {iconsOnly ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
                </button>
                <span className="truncate text-sm font-semibold" style={{ color: "var(--ws-text)" }}>{title}</span>
              </span>
              <div className="flex items-center gap-2">
                <SiteSwitcher />
                <AdminLink />
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-auto" style={{ padding: "var(--ws-pad)" }}>{content}</main>
          </div>
        </div>
      </div>
    );
  }

  const header = (
    <header className="relative z-10 shrink-0 border-b" style={surfaceBar}>
      <div className="flex h-16 items-center gap-6 px-6">
        <Brand />
        {theme.navPosition === "top" && (
          <nav aria-label="Main" className="flex h-full min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
            {nav.map((e) => <NavItem key={e.to} entry={e} theme={theme} placement="top" />)}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          <SiteSwitcher />
          <AdminLink />
          <UserChip />
        </div>
      </div>
    </header>
  );

  if (theme.navPosition === "bottom") {
    return (
      <div {...rootProps} className="relative flex h-full flex-col overflow-hidden">
        <OfflineBanner />
        {blobs}
        {header}
        <main className="relative min-h-0 flex-1 overflow-auto pb-28" style={{ padding: "var(--ws-pad)", paddingBottom: "7rem" }}>{content}</main>
        <nav aria-label="Main" className="absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-stretch gap-1 overflow-x-auto border px-2 py-1.5" style={{ ...surfaceBar, borderRadius: "var(--ws-btn-radius)", boxShadow: "0 12px 32px -12px rgb(15 23 42 / 0.25)" }}>
          {nav.map((e) => <NavItem key={e.to} entry={e} theme={theme} placement="bottom" />)}
        </nav>
      </div>
    );
  }

  // Top navigation. The workbench shell adds an overview rail beside the work area.
  return (
    <div {...rootProps} className="relative flex h-full flex-col overflow-hidden">
      <OfflineBanner />
      {blobs}
      {header}
      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto" style={{ padding: "var(--ws-pad)" }}>{content}</main>
        {config.shell === "workbench" && (
          <aside aria-label="Overview" className="hidden w-72 shrink-0 flex-col gap-3 overflow-auto border-l p-4 lg:flex" style={surfaceBar}>
            <p className="ws-caps text-[11px] font-semibold" style={{ color: "var(--ws-muted)" }}>Overview</p>
            {[
              ["Website", config.name],
              ["Pages", String(nav.length)],
              ["Modules", String(config.modules.nodes.length)],
              ["Release", `v${version ?? "—"}`],
              ["Theme", theme.name],
            ].map(([k, v]) => (
              <div key={k} className="ws-card border p-3" style={{ borderColor: "var(--ws-border)", borderRadius: "var(--ws-radius)", background: "var(--ws-surface)" }}>
                <p className="text-[11px]" style={{ color: "var(--ws-muted)" }}>{k}</p>
                <p className="mt-0.5 text-sm font-semibold" style={{ color: "var(--ws-text)" }}>{v}</p>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
