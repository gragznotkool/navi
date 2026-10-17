import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  GitBranch,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Rewind,
  RotateCcw,
  Users,
  Wrench,
  BarChart3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { ModuleType } from "@opshub/contracts";
import { OfflineBanner } from "../components/feedback";
import { usePalette } from "../stores/palette";
import { useSession } from "../stores/session";
import { useSiteRuntime } from "./context";

const icons: Partial<Record<ModuleType, LucideIcon>> = {
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
    return [{ to: `${basePath}/${page.path}`, label: n.label, icon: (node && icons[node.moduleType]) || LayoutDashboard }];
  });
  const platform: NavEntry[] = [];
  if (permissions.has("config:manage")) {
    platform.push({ to: `${basePath}/admin/builder`, label: "Configuration builder", icon: GitBranch });
    platform.push({ to: `${basePath}/admin/releases`, label: "Releases", icon: History });
    platform.push({ to: `${basePath}/admin/rewind`, label: "Rewind", icon: Rewind });
  }
  return { main, platform };
}

function NavItem({ entry, variant }: { entry: NavEntry; variant: "side" | "top" | "bench" }) {
  const Icon = entry.icon;
  const base = "inline-flex items-center gap-2 text-sm font-medium";
  const styles = {
    side: (a: boolean) => `${base} rounded-ui px-3 py-2 ${a ? "bg-accent text-white" : "text-ink hover:bg-slate-100"}`,
    top: (a: boolean) => `${base} h-full border-b-2 px-3 ${a ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`,
    bench: (a: boolean) => `${base} h-full border-b-2 px-3 ${a ? "border-white text-white" : "border-transparent text-slate-300 hover:text-white"}`,
  }[variant];
  return (
    <NavLink to={entry.to} end className={({ isActive }) => styles(isActive)}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {entry.label}
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
        className={`h-8 rounded-ui border px-2 text-sm font-medium ${
          dark ? "border-slate-600 bg-slate-800 text-white" : "border-line bg-surface text-ink"
        }`}
      >
        {session?.memberships.map((m) => (
          <option key={m.siteId} value={m.siteSlug}>
            {m.siteSlug}
          </option>
        ))}
      </select>
    </div>
  );
}

function UserMenu({ dark }: { dark?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3">
      <span className={`hidden text-xs sm:inline ${dark ? "text-slate-300" : "text-muted"}`}>
        {session?.user.displayName}
      </span>
      <button
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        className={`inline-flex h-8 items-center gap-1.5 rounded-ui px-2 text-xs font-medium ${
          dark ? "text-slate-200 hover:bg-slate-700" : "text-ink hover:bg-slate-100"
        }`}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
      </button>
    </div>
  );
}

function Breadcrumbs({ current, dark }: { current: string; dark?: boolean }) {
  const { config, basePath } = useSiteRuntime();
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-xs ${dark ? "text-slate-300" : "text-muted"}`}>
      <Link to="/" className="hover:underline">
        Sites
      </Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <Link to={basePath} className="hover:underline">
        {config.name}
      </Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <span aria-current="page" className={dark ? "text-white" : "text-ink"}>
        {current}
      </span>
    </nav>
  );
}

function PreviewBanner() {
  const { preview } = useSiteRuntime();
  if (!preview) return null;
  return (
    <div role="status" className="bg-amber-100 px-4 py-1.5 text-xs text-amber-900">
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

  const { main, platform } = useNav();
  const style = { "--accent": config.theme.primary, "--accent-2": config.theme.secondary } as CSSProperties;
  const Brand = (
    <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden className="grid h-6 w-6 place-items-center rounded bg-accent text-xs font-bold text-white">
        O
      </span>
      {!compact && <span>OpsHub</span>}
    </Link>
  );
  const all = [...main, ...platform];

  // Offer this site's pages in the Ctrl+K palette while the shell is mounted.
  const setSiteCommands = usePalette((s) => s.setSiteCommands);
  const navKey = all.map((e) => `${e.to}|${e.label}`).join(",");
  useEffect(() => {
    setSiteCommands(all.map((e) => ({ id: `go:${e.to}`, label: `${config.name}: ${e.label}`, group: "Go to" as const, to: e.to })));
    return () => setSiteCommands([]);
    // `all` is derived from navKey, which is the stable change signal.
  }, [navKey, config.name, setSiteCommands]);

  // Shell 1: Sidebar shell (Central Stores)
  if (config.shell === "sidebar") {
    return (
      <div style={style} className="flex h-full flex-col" data-shell="sidebar">
        <OfflineBanner />
        <PreviewBanner />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`flex shrink-0 flex-col gap-3 border-r border-line bg-surface p-3 transition-all duration-150 ${
              compact ? "w-16 items-center" : "w-60"
            }`}
          >
            <div className="flex w-full items-center justify-between">
              {Brand}
              <button
                type="button"
                onClick={() => setCompact(!compact)}
                aria-pressed={compact}
                aria-label="Collapse navigation"
                className="rounded border border-line p-1 text-xs text-muted hover:bg-slate-100 hover:text-ink"
                title={compact ? "Expand sidebar" : "Collapse sidebar"}
              >
                {compact ? "»" : "«"}
              </button>
            </div>
            {!compact && <SiteSwitcher />}
            {!compact && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Role: {roleName}
              </span>
            )}
            <nav aria-label="Main" className="flex w-full flex-col gap-1">
              {main.map((e) => (
                <NavItem key={e.to} entry={e} variant="side" />
              ))}
            </nav>
            {platform.length > 0 && !compact && (
              <nav aria-label="Platform administration" className="flex flex-col gap-1 border-t border-line pt-3">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted">Platform</p>
                {platform.map((e) => (
                  <NavItem key={e.to} entry={e} variant="side" />
                ))}
              </nav>
            )}
            <div className="mt-auto w-full pt-2 border-t border-line">
              <UserMenu />
            </div>
          </aside>
          <main className="min-w-0 flex-1 overflow-auto p-6">
            <div className="mb-3">
              <Breadcrumbs current={title} />
            </div>
            {children}
          </main>
        </div>
      </div>
    );
  }

  // Shell 2: Workbench shell (Distribution)
  if (config.shell === "workbench") {
    return (
      <div style={style} className="flex h-full flex-col" data-shell="workbench">
        <OfflineBanner />
        <PreviewBanner />
        <header className="bg-slate-900 text-white">
          <div className="flex h-12 items-center gap-4 px-4">
            {Brand}
            <SiteSwitcher dark />
            <span className="hidden rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300 sm:inline">
              Role: {roleName}
            </span>
            <div className="ml-auto flex items-center gap-3">
              <UserMenu dark />
            </div>
          </div>
          <nav aria-label="Main" className="toolrail flex h-10 items-stretch gap-1 overflow-x-auto border-t border-slate-700 px-3">
            {all.map((e) => (
              <NavItem key={e.to} entry={e} variant="bench" />
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Central work area */}
          <main className="work-area min-w-0 flex-1 overflow-auto bg-slate-50 p-6" aria-label={title}>
            <div className="mb-3 flex items-center justify-between border-b border-line pb-3">
              <div>
                <Breadcrumbs current={title} />
                <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
              </div>
              <span className="text-xs font-medium text-muted">{config.name}</span>
            </div>
            {children}
          </main>

          {/* Right Inspector panel */}
          <aside
            aria-label="Inspector"
            className="hidden w-64 shrink-0 flex-col gap-4 border-l border-line bg-surface p-4 lg:flex"
          >
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Workspace Details</h2>
              <dl className="mt-3 grid gap-2.5 text-xs">
                <div>
                  <dt className="text-muted">Active Site</dt>
                  <dd className="font-semibold text-ink">{config.name}</dd>
                </div>
                <div>
                  <dt className="text-muted">Slug</dt>
                  <dd className="font-mono text-ink">/{slug}</dd>
                </div>
                <div>
                  <dt className="text-muted">Your Role</dt>
                  <dd className="font-medium text-ink">{roleName}</dd>
                </div>
                <div>
                  <dt className="text-muted">Current Page</dt>
                  <dd className="font-medium text-ink">{title}</dd>
                </div>
                <div>
                  <dt className="text-muted">Release</dt>
                  <dd className="font-mono text-ink">v{version ?? "draft"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Shell Architecture</dt>
                  <dd className="capitalize text-ink">{config.shell}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // Shell 3: Topbar cards shell (Service Centre)
  return (
    <div style={style} className="flex h-full flex-col" data-shell="topbar-cards">
      <OfflineBanner />
      <PreviewBanner />
      <header className="topbar border-b border-line bg-surface">
        <div className="flex h-14 items-center gap-4 px-6">
          {Brand}
          <strong className="text-sm font-semibold text-ink">{config.name}</strong>
          <span className="hidden rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline">
            Role: {roleName}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <SiteSwitcher />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Main" className="flex h-10 items-stretch gap-1 overflow-x-auto border-t border-line px-4">
          {all.map((e) => (
            <NavItem key={e.to} entry={e} variant="top" />
          ))}
        </nav>
      </header>
      {/* Quick entry card strip */}
      <nav aria-label="Page cards" className="card-strip flex gap-2 overflow-x-auto border-b border-line bg-slate-50/70 p-3 px-6">
        {main.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-ui border px-3 py-1.5 text-xs font-semibold transition ${
                isActive ? "border-accent bg-surface text-accent shadow-xs" : "border-line bg-surface text-muted hover:border-slate-300 hover:text-ink"
              }`
            }
          >
            <n.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mb-3">
          <Breadcrumbs current={title} />
        </div>
        {children}
      </main>
    </div>
  );
}
