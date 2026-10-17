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
  RotateCcw,
  Users,
  Wrench,
  BarChart3,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import type { ModuleType } from "@opshub/contracts";
import { OfflineBanner } from "../components/feedback";
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
          <span className="font-['Outfit',sans-serif] text-base font-extrabold tracking-wide uppercase text-[#0F172A]">
            NAVI
          </span>
        </div>
      )}
    </Link>
  );
  const all = [...main, ...platform];

  // Shell 1: Sidebar shell (Central Stores)
  if (config.shell === "sidebar") {
    return (
      <div style={style} className="flex h-full flex-col industrial-dot-grid" data-shell="sidebar">
        <OfflineBanner />
        <PreviewBanner />
        <div className="flex min-h-0 flex-1 p-4 gap-4">
          <aside
            className={`devfest-card flex shrink-0 flex-col gap-3.5 p-4 transition-all duration-150 ${
              compact ? "w-20 items-center" : "w-64"
            }`}
          >
            <div className="flex w-full items-center justify-between border-b-2 border-slate-100 pb-3">
              {Brand}
              <button
                type="button"
                onClick={() => setCompact(!compact)}
                aria-pressed={compact}
                aria-label="Collapse navigation"
                className="devfest-btn rounded-full bg-slate-100 p-1.5 font-mono text-xs text-slate-700 hover:bg-slate-200 transition"
                title={compact ? "Expand sidebar" : "Collapse sidebar"}
              >
                {compact ? "»" : "«"}
              </button>
            </div>
            {!compact && <SiteSwitcher />}
            {!compact && (
              <div className="flex items-center justify-between rounded-full border-2 border-[#1E293B] bg-slate-50 px-3 py-1 font-mono text-xs shadow-[2px_2px_0px_#1E293B]">
                <span className="uppercase font-bold text-slate-500">Role:</span>
                <span className="font-extrabold text-[#2563EB]">{roleName}</span>
              </div>
            )}
            <nav aria-label="Main" className={`flex w-full flex-col gap-1.5 ${compact ? "items-center" : ""}`}>
              {main.map((e) => (
                <NavItem key={e.to} entry={e} variant="side" iconOnly={compact} />
              ))}
            </nav>
            {platform.length > 0 && (
              <nav aria-label="Platform administration" className={`flex w-full flex-col gap-1.5 border-t-2 border-slate-100 pt-3 ${compact ? "items-center" : ""}`}>
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
            <div className="mt-auto w-full border-t-2 border-slate-100 pt-3">
              <UserMenu iconOnly={compact} />
            </div>
          </aside>
          <main className="devfest-card min-w-0 flex-1 overflow-auto p-6 text-[#0F172A]">
            <div className="mb-6">
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
      <div style={style} className="flex h-full flex-col industrial-dot-grid" data-shell="workbench">
        <OfflineBanner />
        <PreviewBanner />
        <header className="border-b-2 border-[#1E293B] bg-white bg-slate-900 text-[#0F172A] shadow-[0_2px_0px_#1E293B]">
          <div className="flex h-14 items-center gap-4 px-6">
            {Brand}
            <SiteSwitcher />
            <span className="hidden rounded-full border-2 border-[#1E293B] bg-slate-50 px-3 py-1 font-mono text-xs font-bold sm:inline shadow-[2px_2px_0px_#1E293B]">
              ROLE: <strong className="text-[#2563EB]">{roleName}</strong>
            </span>
            <div className="ml-auto flex items-center gap-3">
              <UserMenu />
            </div>
          </div>
          <nav aria-label="Main" className="toolrail flex h-10 items-stretch gap-1 overflow-x-auto border-t-2 border-slate-100 bg-slate-50 px-4">
            {all.map((e) => (
              <NavItem key={e.to} entry={e} variant="bench" />
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1 p-4 gap-4">
          {/* Central work area */}
          <main className="work-area devfest-card min-w-0 flex-1 overflow-auto p-6 text-[#0F172A]" aria-label={title}>
            <div className="mb-6 flex items-center justify-between border-b-2 border-slate-100 pb-4">
              <div>
                <Breadcrumbs current={title} />
                <h1 className="font-['Outfit',sans-serif] text-2xl font-black tracking-tight text-[#0F172A] mt-1">
                  {title}
                </h1>
              </div>
              <span className="font-mono text-xs font-bold text-[#0F172A] border-2 border-[#1E293B] bg-[#FBBC04] px-3 py-1 rounded-full shadow-[2px_2px_0px_#1E293B]">
                {config.name}
              </span>
            </div>
            {children}
          </main>

          {/* Right Inspector panel */}
          <aside
            aria-label="Inspector"
            className="devfest-card hidden w-72 shrink-0 flex-col gap-4 p-5 lg:flex text-xs"
          >
            <div>
              <div className="flex items-center gap-2 border-b-2 border-slate-100 pb-2.5 font-mono text-xs font-black uppercase tracking-wider text-[#0F172A]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FBBC04] border border-[#1E293B]" />
                TELEMETRY & STATUS
              </div>
              <dl className="mt-4 grid gap-3 font-mono text-xs">
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <dt className="text-slate-500 font-bold uppercase text-[10px]">Active Site</dt>
                  <dd className="font-black text-[#0F172A] mt-0.5">{config.name}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <dt className="text-slate-500 font-bold uppercase text-[10px]">Node Identifier</dt>
                  <dd className="text-[#2563EB] font-bold mt-0.5">/{slug}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <dt className="text-slate-500 font-bold uppercase text-[10px]">Access Role</dt>
                  <dd className="text-[#0F172A] font-bold mt-0.5">{roleName}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <dt className="text-slate-500 font-bold uppercase text-[10px]">Release Target</dt>
                  <dd className="text-[#34A853] font-black mt-0.5">v{version ?? "draft"}</dd>
                </div>
                <div className="rounded-xl border-2 border-[#1E293B] bg-slate-50 p-2.5 shadow-[2px_2px_0px_#1E293B]">
                  <dt className="text-slate-500 font-bold uppercase text-[10px]">Architecture</dt>
                  <dd className="capitalize text-slate-700 font-bold mt-0.5">{config.shell}</dd>
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
    <div style={style} className="flex h-full flex-col industrial-dot-grid" data-shell="topbar-cards">
      <OfflineBanner />
      <PreviewBanner />
      <header className="topbar border-b-2 border-[#1E293B] bg-white shadow-[0_2px_0px_#1E293B]">
        <div className="flex h-16 items-center gap-4 px-6">
          {Brand}
          <div className="h-5 w-[2px] bg-slate-200" />
          <strong className="font-['Outfit',sans-serif] text-sm font-bold uppercase tracking-wider text-[#0F172A]">{config.name}</strong>
          <span className="hidden rounded-full border-2 border-[#1E293B] bg-slate-50 px-3 py-1 font-mono text-xs font-bold sm:inline shadow-[2px_2px_0px_#1E293B]">
            ROLE: <span className="text-[#2563EB]">{roleName}</span>
          </span>
          <div className="ml-auto flex items-center gap-3">
            <SiteSwitcher />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Main" className="flex h-11 items-stretch gap-1 overflow-x-auto border-t-2 border-slate-100 bg-slate-50 px-6">
          {all.map((e) => (
            <NavItem key={e.to} entry={e} variant="top" />
          ))}
        </nav>
      </header>
      {/* Quick entry card strip */}
      <nav aria-label="Page cards" className="card-strip flex gap-3 overflow-x-auto border-b-2 border-[#1E293B] bg-white p-3 px-6 shadow-[0_2px_0px_#1E293B]">
        {main.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-full border-2 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider transition ${
                isActive
                  ? "border-[#1E293B] bg-[#FBBC04] text-[#0F172A] font-black shadow-[2px_2px_0px_#1E293B]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-[#1E293B] hover:text-[#0F172A]"
              }`
            }
          >
            <n.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-auto p-6 text-[#0F172A]">
        <div className="devfest-card p-6 min-h-full">
          <div className="mb-6">
            <Breadcrumbs current={title} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
