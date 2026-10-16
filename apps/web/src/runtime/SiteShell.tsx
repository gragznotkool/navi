import { Boxes, ClipboardCheck, ClipboardList, FileSpreadsheet, GitBranch, History, LayoutDashboard, LogOut, PackageCheck, RotateCcw, Users, Wrench, BarChart3, ChevronRight, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { ModuleType } from "@opshub/contracts";
import { OfflineBanner } from "../components/feedback";
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
        className={`h-8 rounded-ui border px-2 text-sm font-medium ${dark ? "border-slate-600 bg-slate-800 text-white" : "border-line bg-surface text-ink"}`}
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
      <span className={`hidden text-xs sm:inline ${dark ? "text-slate-300" : "text-muted"}`}>{session?.user.displayName}</span>
      <button
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        className={`inline-flex h-8 items-center gap-1.5 rounded-ui px-2 text-xs font-medium ${dark ? "text-slate-200 hover:bg-slate-700" : "text-ink hover:bg-slate-100"}`}
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
      <Link to="/" className="hover:underline">Sites</Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <Link to={basePath} className="hover:underline">{config.name}</Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <span aria-current="page" className={dark ? "text-white" : "text-ink"}>{current}</span>
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
  const { config } = useSiteRuntime();
  const { main, platform } = useNav();
  const style = { "--accent": config.theme.primary, "--accent-2": config.theme.secondary } as CSSProperties;
  const Brand = (
    <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden className="grid h-6 w-6 place-items-center rounded bg-accent text-xs font-bold text-white">O</span>
      OpsHub
    </Link>
  );
  const all = [...main, ...platform];

  if (config.shell === "sidebar") {
    return (
      <div style={style} className="flex h-full flex-col">
        <OfflineBanner />
        <PreviewBanner />
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-line bg-surface p-3">
            {Brand}
            <SiteSwitcher />
            <nav aria-label="Main" className="flex flex-col gap-1">
              {main.map((e) => <NavItem key={e.to} entry={e} variant="side" />)}
            </nav>
            {platform.length > 0 && (
              <nav aria-label="Platform administration" className="flex flex-col gap-1 border-t border-line pt-3">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted">Platform</p>
                {platform.map((e) => <NavItem key={e.to} entry={e} variant="side" />)}
              </nav>
            )}
            <div className="mt-auto"><UserMenu /></div>
          </aside>
          <main className="min-w-0 flex-1 overflow-auto p-6">
            <div className="mb-3"><Breadcrumbs current={title} /></div>
            {children}
          </main>
        </div>
      </div>
    );
  }

  const bench = config.shell === "workbench";
  return (
    <div style={style} className="flex h-full flex-col">
      <OfflineBanner />
      <PreviewBanner />
      <header className={bench ? "bg-slate-900 text-white" : "border-b border-line bg-surface"}>
        <div className="flex h-12 items-center gap-4 px-4">
          {Brand}
          <SiteSwitcher dark={bench} />
          <div className="ml-auto"><UserMenu dark={bench} /></div>
        </div>
        <nav aria-label="Main" className={`flex h-10 items-stretch gap-1 overflow-x-auto px-3 ${bench ? "border-t border-slate-700" : "border-t border-line"}`}>
          {all.map((e) => <NavItem key={e.to} entry={e} variant={bench ? "bench" : "top"} />)}
        </nav>
      </header>
      <main className={`min-h-0 flex-1 overflow-auto ${bench ? "bg-slate-100 p-3" : "p-6"}`}>
        <div className="mb-3"><Breadcrumbs current={title} /></div>
        {children}
      </main>
    </div>
  );
}

