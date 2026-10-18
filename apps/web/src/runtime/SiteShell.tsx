import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Command,
  FileSpreadsheet,
  GitBranch,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Radio,
  RotateCcw,
  ScanLine,
  Search,
  Users,
  Wrench,
  BarChart3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { ModuleType } from "@opshub/contracts";
import { OfflineBanner } from "../components/feedback";
import { ThemeToggle } from "../components/ui";
import { CommandPalette } from "../components/palette/CommandPalette";
import { OperationsFeedDrawer } from "../components/feed/OperationsFeedDrawer";
import { BarcodeScannerModal } from "../components/barcode/BarcodeScannerModal";
import { NotificationBell } from "../components/notifications/NotificationBell";
import { useSession } from "../stores/session";
import { useSiteRuntime } from "./context";

export const moduleIcons: Partial<Record<ModuleType, LucideIcon>> = {
  "dashboard-shell": LayoutDashboard,
  inventory: Boxes,
  request: ClipboardList,
  approval: ClipboardCheck,
  "material-assignment": PackageCheck,
  "assignment-frontend": PackageCheck,
  "consumption-tracking": PackageCheck,
  "return-management": RotateCcw,
  "pcb-repair": Wrench,
  "analytics-dashboard": BarChart3,
  "reports-excel": FileSpreadsheet,
  "user-management": Users,
};

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
}

function useNav(): { main: NavEntry[]; platform: NavEntry[] } {
  const { config, permissions, basePath } = useSiteRuntime();
  const main = config.navigation.flatMap((n) => {
    const page = config.pages.find((p) => p.id === n.pageId);
    if (!page) return [];
    // Role-aware navigation: hide entries the user's permissions cannot open.
    if (page.requiredPermission && !permissions.has(page.requiredPermission)) return [];
    const node = config.modules.nodes.find((m) => m.id === page.nodeId);
    return [{ to: `${basePath}/${page.path}`, label: n.label, icon: (node && moduleIcons[node.moduleType]) || LayoutDashboard }];
  });
  const platform: NavEntry[] = [];
  if (permissions.has("config:manage")) {
    platform.push({ to: `${basePath}/admin/builder`, label: "Configuration builder", icon: GitBranch });
    platform.push({ to: `${basePath}/admin/releases`, label: "Releases", icon: History });
  }
  return { main, platform };
}

function NavItem({ entry, variant, iconOnly }: { entry: NavEntry; variant: "side" | "top" | "bench"; iconOnly?: boolean }) {
  const Icon = entry.icon;
  const base = "inline-flex items-center gap-2 text-xs font-bold tracking-wide uppercase transition-all duration-150";
  const styles = {
    side: (a: boolean) =>
      `${base} rounded-xl ${iconOnly ? "p-2.5 justify-center" : "px-3.5 py-2.5"} ${
        a
          ? "bg-[#FBBC04] text-[#0F172A] border-2 border-[#1E293B] shadow-[2px_2px_0px_#1E293B]"
          : "text-slate-600 hover:bg-slate-100 hover:text-[#0F172A]"
      }`,
    top: (a: boolean) =>
      `${base} h-full border-b-4 px-4 ${
        a
          ? "border-[#FBBC04] text-[#2563EB] font-black bg-blue-50/50"
          : "border-transparent text-slate-500 hover:text-[#0F172A] hover:border-slate-300"
      }`,
    bench: (a: boolean) =>
      `${base} h-full border-b-4 px-4 ${
        a
          ? "border-[#FBBC04] text-[#2563EB] font-black bg-blue-50/50"
          : "border-transparent text-slate-500 hover:text-[#0F172A]"
      }`,
  }[variant];
  return (
    <NavLink to={entry.to} end title={iconOnly ? entry.label : undefined} className={({ isActive }) => styles(isActive)}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {iconOnly ? <span className="sr-only">{entry.label}</span> : entry.label}
    </NavLink>
  );
}

function SiteSwitcher({ dark }: { dark?: boolean }) {
  const session = useSession((s) => s.session);
  const { slug } = useSiteRuntime();
  const navigate = useNavigate();
  return (
    <div>
      <label htmlFor="site-switcher" className="sr-only">
        Switch site
      </label>
      <select
        id="site-switcher"
        value={slug}
        onChange={(e) => navigate(`/s/${e.target.value}`)}
        className="h-8 rounded-full border-2 border-[#1E293B] bg-white px-3 font-mono text-xs font-bold uppercase tracking-wider text-[#0F172A] shadow-[2px_2px_0px_#1E293B] focus:border-[#FBBC04] focus:outline-none"
      >
        {session?.memberships.map((m) => (
          <option key={m.siteId} value={m.siteSlug}>
            LOC: {m.siteSlug.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}

function UserMenu({ dark, iconOnly }: { dark?: boolean; iconOnly?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  return (
    <div className={`flex items-center gap-3 font-mono text-xs font-bold ${iconOnly ? "justify-center" : ""}`}>
      {!iconOnly && (
        <span className="hidden text-slate-600 sm:inline">
          {session?.user.displayName}
        </span>
      )}
      <button
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        title={iconOnly ? "Sign out" : undefined}
        className={`devfest-btn inline-flex h-8 items-center gap-1.5 rounded-full bg-[#EA4335] text-xs font-bold uppercase tracking-wider text-white hover:bg-red-600 transition ${
          iconOnly ? "p-2 justify-center" : "px-3"
        }`}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden /> {!iconOnly && "Sign out"}
      </button>
    </div>
  );
}

function Breadcrumbs({ current, dark }: { current: string; dark?: boolean }) {
  const { config, basePath } = useSiteRuntime();
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-slate-500">
      <Link to="/" className="font-bold text-[#2563EB] hover:underline transition">
        OPS_HUB
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      <Link to={basePath} className="font-bold text-slate-700 hover:text-[#0F172A] transition">
        {config.name}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      <span aria-current="page" className="font-black text-[#0F172A] bg-yellow-100 px-2 py-0.5 rounded-full border border-yellow-300">
        {current}
      </span>
    </nav>
  );
}

function PreviewBanner() {
  const { preview } = useSiteRuntime();
  if (!preview) return null;
  return (
    <div role="status" className="bg-amber-100 px-4 py-1.5 text-xs text-amber-900 border-b-2 border-amber-300 font-bold">
      Preview of an unpublished draft configuration. Data shown is live; nothing here has been published.
    </div>
  );
}

/** Application shell. The variant comes from configuration (`shell`), never from the site slug. */
export function SiteShell({ title, children }: { title: string; children: ReactNode }) {
  const { config, slug, version } = useSiteRuntime();
  const session = useSession((s) => s.session);
  const membership = session?.memberships.find((m) => m.siteSlug === slug);
  const roleName = membership?.roles.join(", ") || "Member";
  const [compact, setCompact] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isFeedOpen, setIsFeedOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const { main, platform } = useNav();
  const style = { "--accent": config.theme.primary, "--accent-2": config.theme.secondary } as CSSProperties;
  const Brand = (
    <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold">
      <img
        src="/navi-logo.png"
        alt="NAVI"
        className="h-8 w-auto object-contain rounded-md border border-[#1E293B] shadow-[2px_2px_0px_#1E293B]"
      />
      {!compact && (
        <div className="flex flex-col">
          <span className="font-['Outfit',sans-serif] text-base font-extrabold tracking-wide uppercase text-[#0F172A] dark:text-white">
            NAVI
          </span>
        </div>
      )}
    </Link>
  );
  const all = [...main, ...platform];

  const QuickBar = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setIsPaletteOpen(true)}
        className="flex items-center gap-1.5 h-8 rounded-full border-2 border-[#1E293B] bg-slate-100 px-2.5 font-mono text-xs font-bold text-slate-700 shadow-[2px_2px_0px_#1E293B] hover:bg-[#FBBC04] hover:text-[#0F172A] transition dark:border-[#334155] dark:bg-slate-800 dark:text-slate-300"
        title="Open Global Command Palette (⌘K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">Dispatch</span>
        <kbd className="rounded border border-slate-300 bg-white px-1 text-[10px] font-black dark:border-slate-700 dark:bg-slate-900">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setIsFeedOpen(true)}
        className="flex items-center gap-1.5 h-8 rounded-full border-2 border-[#1E293B] bg-emerald-50 px-2.5 font-mono text-xs font-bold text-emerald-800 shadow-[2px_2px_0px_#1E293B] hover:bg-emerald-100 transition dark:border-[#334155] dark:bg-emerald-950/40 dark:text-emerald-300"
        title="Live Operations Telemetry Stream"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="hidden sm:inline">LIVE OPS</span>
      </button>

      <button
        type="button"
        onClick={() => setIsScannerOpen(true)}
        className="h-8 w-8 inline-flex items-center justify-center rounded-full border-2 border-[#1E293B] bg-white text-[#0F172A] shadow-[2px_2px_0px_#1E293B] hover:-translate-y-0.5 active:translate-y-0.5 transition dark:border-[#334155] dark:bg-[#1E293B] dark:text-white"
        title="Scan Barcode / QR Tag"
      >
        <ScanLine className="h-4 w-4 text-[#FBBC04]" />
      </button>

      <NotificationBell onOpenFeed={() => setIsFeedOpen(true)} />
      <ThemeToggle />
    </div>
  );

  const MobileBottomNav = (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-14 items-center justify-around border-t-2 border-[#1E293B] bg-white px-2 shadow-[0_-2px_0px_#1E293B] md:hidden dark:border-[#334155] dark:bg-[#131B2E]">
      {main.slice(0, 4).map((entry) => {
        const Icon = entry.icon;
        return (
          <NavLink
            key={entry.to}
            to={entry.to}
            end
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-1 px-2 font-mono text-[10px] font-bold ${
                isActive ? "text-[#2563EB] dark:text-[#FBBC04]" : "text-slate-500 hover:text-[#0F172A]"
              }`
            }
          >
            <Icon className="h-5 w-5 mb-0.5" />
            <span className="truncate max-w-[64px]">{entry.label}</span>
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={() => setIsPaletteOpen(true)}
        className="flex flex-col items-center justify-center py-1 px-2 font-mono text-[10px] font-bold text-slate-500"
      >
        <Search className="h-5 w-5 mb-0.5 text-[#FBBC04]" />
        <span>Menu</span>
      </button>
    </nav>
  );

  const Modals = (
    <>
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onOpenScanner={() => setIsScannerOpen(true)}
        onOpenActivityFeed={() => setIsFeedOpen(true)}
      />
      <OperationsFeedDrawer
        isOpen={isFeedOpen}
        onClose={() => setIsFeedOpen(false)}
      />
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
      />
    </>
  );

  // Shell 1: Sidebar shell (Central Stores)
  if (config.shell === "sidebar") {
    return (
      <div style={style} className="flex h-full flex-col industrial-dot-grid pb-14 md:pb-0" data-shell="sidebar">
        <OfflineBanner />
        <PreviewBanner />
        <div className="flex min-h-0 flex-1 p-4 gap-4">
          <aside
            className={`devfest-card flex shrink-0 flex-col gap-3.5 p-4 transition-all duration-150 ${
              compact ? "w-20 items-center" : "w-64"
            }`}
          >
            <div className="flex w-full items-center justify-between border-b-2 border-slate-100 pb-3 dark:border-slate-800">
              {Brand}
              <button
                type="button"
                onClick={() => setCompact(!compact)}
                aria-pressed={compact}
                aria-label="Collapse navigation"
                className="devfest-btn rounded-full bg-slate-100 p-1.5 font-mono text-xs text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-300"
                title={compact ? "Expand sidebar" : "Collapse sidebar"}
              >
                {compact ? "»" : "«"}
              </button>
            </div>
            {!compact && <SiteSwitcher />}
            {!compact && (
              <div className="flex items-center justify-between rounded-full border-2 border-[#1E293B] bg-slate-50 px-3 py-1 font-mono text-xs shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
                <span className="uppercase font-bold text-slate-500">Role:</span>
                <span className="font-extrabold text-[#2563EB] dark:text-[#FBBC04]">{roleName}</span>
              </div>
            )}
            <nav aria-label="Main" className={`flex w-full flex-col gap-1.5 ${compact ? "items-center" : ""}`}>
              {main.map((e) => (
                <NavItem key={e.to} entry={e} variant="side" iconOnly={compact} />
              ))}
            </nav>
            {platform.length > 0 && (
              <nav aria-label="Platform administration" className={`flex w-full flex-col gap-1.5 border-t-2 border-slate-100 pt-3 dark:border-slate-800 ${compact ? "items-center" : ""}`}>
                {!compact && (
                  <p className="px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    // PLATFORM ADMIN
                  </p>
                )}
                {platform.map((e) => (
                  <NavItem key={e.to} entry={e} variant="side" iconOnly={compact} />
                ))}
              </nav>
            )}
            <div className="mt-auto w-full border-t-2 border-slate-100 pt-3 dark:border-slate-800">
              <UserMenu iconOnly={compact} />
            </div>
          </aside>
          <main className="devfest-card min-w-0 flex-1 overflow-auto p-6 text-[#0F172A] dark:text-[#F8FAFC]">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b-2 border-slate-100 pb-3 dark:border-slate-800">
              <Breadcrumbs current={title} />
              {QuickBar}
            </div>
            {children}
          </main>
        </div>
        {MobileBottomNav}
        {Modals}
      </div>
    );
  }

  // Shell 2: Workbench shell (Distribution)
  if (config.shell === "workbench") {
    return (
      <div style={style} className="flex h-full flex-col industrial-dot-grid pb-14 md:pb-0" data-shell="workbench">
        <OfflineBanner />
        <PreviewBanner />
        <header className="border-b-2 border-[#1E293B] bg-white bg-slate-900 text-[#0F172A] shadow-[0_2px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E] dark:text-white">
          <div className="flex h-14 items-center gap-4 px-6">
            {Brand}
            <SiteSwitcher />
            <span className="hidden rounded-full border-2 border-[#1E293B] bg-slate-50 px-3 py-1 font-mono text-xs font-bold sm:inline shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
              ROLE: <strong className="text-[#2563EB] dark:text-[#FBBC04]">{roleName}</strong>
            </span>
            <div className="ml-auto flex items-center gap-3">
              {QuickBar}
              <UserMenu />
            </div>
          </div>
          <nav aria-label="Main" className="toolrail flex h-10 items-stretch gap-1 overflow-x-auto border-t-2 border-slate-100 bg-slate-50 px-4 dark:border-slate-800 dark:bg-[#1A243B]">
            {all.map((e) => (
              <NavItem key={e.to} entry={e} variant="bench" />
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1 p-4 gap-4">
          {/* Central work area */}
          <main className="work-area devfest-card min-w-0 flex-1 overflow-auto p-6 text-[#0F172A] dark:text-[#F8FAFC]" aria-label={title}>
            <div className="mb-6 flex items-center justify-between border-b-2 border-slate-100 pb-4 dark:border-slate-800">
              <Breadcrumbs current={title} />
              <span className="font-mono text-xs font-bold text-[#0F172A] border-2 border-[#1E293B] bg-[#FBBC04] px-3 py-1 rounded-full shadow-[2px_2px_0px_#1E293B]">
                {config.name}
              </span>
            </div>
            {children}
          </main>

          {/* Right Inspector panel */}
          <aside
            aria-label="Inspector"
            className="devfest-card hidden w-72 shrink-0 flex-col gap-4 p-5 lg:flex text-xs dark:text-[#F8FAFC]"
          >
            <div>
              <div className="flex items-center gap-2 border-b-2 border-slate-100 pb-2.5 font-mono text-xs font-black uppercase tracking-wider text-[#0F172A] dark:border-slate-800 dark:text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FBBC04] border border-[#1E293B]" />
                TELEMETRY & STATUS
              </div>
              <dl className="mt-4 grid gap-3 font-mono text-xs">
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
                  <dt className="text-slate-500 font-bold uppercase text-[10px] dark:text-slate-400">Active Site</dt>
                  <dd className="font-black text-[#0F172A] mt-0.5 dark:text-white">{config.name}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
                  <dt className="text-slate-500 font-bold uppercase text-[10px] dark:text-slate-400">Node Identifier</dt>
                  <dd className="text-[#2563EB] font-bold mt-0.5 dark:text-[#FBBC04]">/{slug}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
                  <dt className="text-slate-500 font-bold uppercase text-[10px] dark:text-slate-400">Access Role</dt>
                  <dd className="text-[#0F172A] font-bold mt-0.5 dark:text-white">{roleName}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
                  <dt className="text-slate-500 font-bold uppercase text-[10px] dark:text-slate-400">Release Target</dt>
                  <dd className="text-[#34A853] font-black mt-0.5">v{version ?? "draft"}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
                  <dt className="text-slate-500 font-bold uppercase text-[10px] dark:text-slate-400">Architecture</dt>
                  <dd className="capitalize text-slate-700 font-bold mt-0.5 dark:text-slate-300">{config.shell}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
        {MobileBottomNav}
        {Modals}
      </div>
    );
  }

  // Shell 3: Topbar cards shell (Service Centre)
  return (
    <div style={style} className="flex h-full flex-col industrial-dot-grid pb-14 md:pb-0" data-shell="topbar-cards">
      <OfflineBanner />
      <PreviewBanner />
      <header className="topbar border-b-2 border-[#1E293B] bg-white shadow-[0_2px_0px_#1E293B] dark:border-[#334155] dark:bg-[#131B2E]">
        <div className="flex h-16 items-center gap-4 px-6">
          {Brand}
          <div className="h-5 w-[2px] bg-slate-200 dark:bg-slate-700" />
          <strong className="font-['Outfit',sans-serif] text-sm font-bold uppercase tracking-wider text-[#0F172A] dark:text-white">{config.name}</strong>
          <span className="hidden rounded-full border-2 border-[#1E293B] bg-slate-50 px-3 py-1 font-mono text-xs font-bold sm:inline shadow-[2px_2px_0px_#1E293B] dark:border-[#334155] dark:bg-slate-800">
            ROLE: <span className="text-[#2563EB] dark:text-[#FBBC04]">{roleName}</span>
          </span>
          <div className="ml-auto flex items-center gap-3">
            <SiteSwitcher />
            {QuickBar}
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Main" className="flex h-11 items-stretch gap-1 overflow-x-auto border-t-2 border-slate-100 bg-slate-50 px-6 dark:border-slate-800 dark:bg-[#1A243B]">
          {all.map((e) => (
            <NavItem key={e.to} entry={e} variant="top" />
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6 text-[#0F172A] dark:text-[#F8FAFC]">
        <div className="devfest-card p-6 min-h-full">
          <div className="mb-6">
            <Breadcrumbs current={title} />
          </div>
          {children}
        </div>
      </main>
      {MobileBottomNav}
      {Modals}
    </div>
  );
}
