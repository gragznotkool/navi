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
  const base = "inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase transition-all duration-150";
  const styles = {
    side: (a: boolean) =>
      `${base} rounded-[2px] px-3 py-2 ${
        a
          ? "bg-[#FFE500] text-[#080909] font-bold shadow-[0_0_12px_rgba(255,229,0,0.25)]"
          : "text-[#A5A8A6] hover:bg-[#1f2222] hover:text-[#F5F5F0]"
      }`,
    top: (a: boolean) =>
      `${base} h-full border-b-2 px-3.5 ${
        a
          ? "border-[#FFE500] text-[#FFE500] font-bold bg-[#FFE500]/5"
          : "border-transparent text-[#A5A8A6] hover:text-[#F5F5F0] hover:border-[#303432]"
      }`,
    bench: (a: boolean) =>
      `${base} h-full border-b-2 px-3.5 ${
        a
          ? "border-[#FFE500] text-[#FFE500] font-bold bg-[#FFE500]/10"
          : "border-transparent text-[#777C79] hover:text-[#F5F5F0]"
      }`,
  }[variant];
  return (
    <NavLink to={entry.to} end className={({ isActive }) => styles(isActive)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
        className="h-7 rounded-[2px] border border-[#303432] bg-[#111313] px-2 font-mono text-xs font-semibold uppercase tracking-wider text-[#FFE500] focus:border-[#FFE500] focus:outline-none"
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

function UserMenu({ dark }: { dark?: boolean }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3 font-mono text-xs">
      <span className="hidden text-[#A5A8A6] sm:inline">
        {session?.user.displayName}
      </span>
      <button
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        className="inline-flex h-7 items-center gap-1.5 rounded-[2px] border border-[#303432] bg-[#111313] px-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#FF5C5C] hover:bg-[#FF5C5C]/10 hover:border-[#FF5C5C]/40 transition"
      >
        <LogOut className="h-3 w-3" aria-hidden /> Sign out
      </button>
    </div>
  );
}

function Breadcrumbs({ current, dark }: { current: string; dark?: boolean }) {
  const { config, basePath } = useSiteRuntime();
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[#777C79]">
      <Link to="/" className="text-[#A5A8A6] hover:text-[#FFE500] transition">
        OPS_HUB
      </Link>
      <ChevronRight className="h-3 w-3 text-[#777C79]" aria-hidden />
      <Link to={basePath} className="text-[#A5A8A6] hover:text-[#FFE500] transition">
        {config.name}
      </Link>
      <ChevronRight className="h-3 w-3 text-[#777C79]" aria-hidden />
      <span aria-current="page" className="font-bold text-[#FFE500]">
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
    <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold">
      <div className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-[#FFE500] text-[11px] font-black text-[#080909] shadow-[0_0_10px_rgba(255,229,0,0.4)]">
        OH
      </div>
      {!compact && (
        <div className="flex flex-col">
          <span className="font-['Barlow_Condensed',sans-serif] text-base font-extrabold tracking-wider uppercase text-[#F5F5F0]">
            OpsHub
          </span>
        </div>
      )}
    </Link>
  );
  const all = [...main, ...platform];

  // Shell 1: Sidebar shell (Central Stores)
  if (config.shell === "sidebar") {
    return (
      <div style={style} className="flex h-full flex-col bg-[#080909]" data-shell="sidebar">
        <OfflineBanner />
        <PreviewBanner />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`flex shrink-0 flex-col gap-3.5 border-r border-[#303432] bg-[#111313] p-3.5 transition-all duration-150 ${
              compact ? "w-16 items-center" : "w-64"
            }`}
          >
            <div className="flex w-full items-center justify-between border-b border-[#303432] pb-3">
              {Brand}
              <button
                type="button"
                onClick={() => setCompact(!compact)}
                aria-pressed={compact}
                aria-label="Collapse navigation"
                className="rounded-[2px] border border-[#303432] bg-[#171919] p-1 font-mono text-[10px] text-[#A5A8A6] hover:border-[#FFE500] hover:text-[#FFE500] transition"
                title={compact ? "Expand sidebar" : "Collapse sidebar"}
              >
                {compact ? "»" : "«"}
              </button>
            </div>
            {!compact && <SiteSwitcher />}
            {!compact && (
              <div className="flex items-center justify-between rounded-[2px] border border-[#303432] bg-[#171919] px-2.5 py-1 font-mono text-[10px] text-[#A5A8A6]">
                <span className="uppercase text-[#777C79]">Role:</span>
                <span className="font-bold text-[#FFE500]">{roleName}</span>
              </div>
            )}
            <nav aria-label="Main" className="flex w-full flex-col gap-1">
              {main.map((e) => (
                <NavItem key={e.to} entry={e} variant="side" />
              ))}
            </nav>
            {platform.length > 0 && !compact && (
              <nav aria-label="Platform administration" className="flex flex-col gap-1 border-t border-[#303432] pt-3">
                <p className="px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-[#777C79]">
                  // PLATFORM ADMIN
                </p>
                {platform.map((e) => (
                  <NavItem key={e.to} entry={e} variant="side" />
                ))}
              </nav>
            )}
            <div className="mt-auto w-full border-t border-[#303432] pt-3">
              <UserMenu />
            </div>
          </aside>
          <main className="min-w-0 flex-1 overflow-auto bg-[#080909] p-6 text-[#F5F5F0]">
            <div className="mb-4">
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
      <div style={style} className="flex h-full flex-col bg-[#080909]" data-shell="workbench">
        <OfflineBanner />
        <PreviewBanner />
        <header className="border-b border-[#303432] bg-[#111313] text-[#F5F5F0]">
          <div className="flex h-12 items-center gap-4 px-4">
            {Brand}
            <SiteSwitcher dark />
            <span className="hidden rounded-[2px] border border-[#303432] bg-[#171919] px-2 py-0.5 font-mono text-[11px] text-[#A5A8A6] sm:inline">
              ROLE: <strong className="text-[#FFE500]">{roleName}</strong>
            </span>
            <div className="ml-auto flex items-center gap-3">
              <UserMenu dark />
            </div>
          </div>
          <nav aria-label="Main" className="toolrail flex h-9 items-stretch gap-1 overflow-x-auto border-t border-[#303432] bg-[#171919] px-3">
            {all.map((e) => (
              <NavItem key={e.to} entry={e} variant="bench" />
            ))}
          </nav>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Central work area */}
          <main className="work-area min-w-0 flex-1 overflow-auto bg-[#080909] p-6 text-[#F5F5F0]" aria-label={title}>
            <div className="mb-4 flex items-center justify-between border-b border-[#303432] pb-3">
              <div>
                <Breadcrumbs current={title} />
                <h1 className="font-['Barlow_Condensed',sans-serif] text-2xl font-black uppercase tracking-wider text-[#F5F5F0]">
                  {title}
                </h1>
              </div>
              <span className="font-mono text-xs text-[#FFE500] border border-[#FFE500]/30 bg-[#FFE500]/10 px-2 py-0.5 rounded-[2px]">
                {config.name}
              </span>
            </div>
            {children}
          </main>

          {/* Right Inspector panel */}
          <aside
            aria-label="Inspector"
            className="hidden w-68 shrink-0 flex-col gap-4 border-l border-[#303432] bg-[#111313] p-4 lg:flex text-xs"
          >
            <div>
              <div className="flex items-center gap-2 border-b border-[#303432] pb-2 font-mono text-[11px] font-bold uppercase tracking-wider text-[#FFE500]">
                <span className="h-2 w-2 bg-[#FFE500]" />
                TELEMETRY & STATUS
              </div>
              <dl className="mt-3 grid gap-2.5 font-mono text-[11px]">
                <div className="rounded-[2px] border border-[#303432] bg-[#171919] p-2">
                  <dt className="text-[#777C79] uppercase">Active Site</dt>
                  <dd className="font-bold text-[#F5F5F0]">{config.name}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#171919] p-2">
                  <dt className="text-[#777C79] uppercase">Node Identifier</dt>
                  <dd className="text-[#FFE500]">/{slug}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#171919] p-2">
                  <dt className="text-[#777C79] uppercase">Access Role</dt>
                  <dd className="text-[#F5F5F0]">{roleName}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#171919] p-2">
                  <dt className="text-[#777C79] uppercase">Release Target</dt>
                  <dd className="text-[#39D98A]">v{version ?? "draft"}</dd>
                </div>
                <div className="rounded-[2px] border border-[#303432] bg-[#171919] p-2">
                  <dt className="text-[#777C79] uppercase">Architecture</dt>
                  <dd className="capitalize text-[#A5A8A6]">{config.shell}</dd>
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
    <div style={style} className="flex h-full flex-col bg-[#080909]" data-shell="topbar-cards">
      <OfflineBanner />
      <PreviewBanner />
      <header className="topbar border-b border-[#303432] bg-[#111313]">
        <div className="flex h-14 items-center gap-4 px-6">
          {Brand}
          <div className="h-4 w-[1px] bg-[#303432]" />
          <strong className="font-mono text-xs uppercase tracking-wider text-[#F5F5F0]">{config.name}</strong>
          <span className="hidden rounded-[2px] border border-[#303432] bg-[#171919] px-2 py-0.5 font-mono text-[10px] text-[#A5A8A6] sm:inline">
            ROLE: <span className="text-[#FFE500]">{roleName}</span>
          </span>
          <div className="ml-auto flex items-center gap-3">
            <SiteSwitcher />
            <UserMenu />
          </div>
        </div>
        <nav aria-label="Main" className="flex h-10 items-stretch gap-1 overflow-x-auto border-t border-[#303432] bg-[#171919] px-4">
          {all.map((e) => (
            <NavItem key={e.to} entry={e} variant="top" />
          ))}
        </nav>
      </header>
      {/* Quick entry card strip */}
      <nav aria-label="Page cards" className="card-strip flex gap-2 overflow-x-auto border-b border-[#303432] bg-[#111313] p-2.5 px-6">
        {main.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-[2px] border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition ${
                isActive
                  ? "border-[#FFE500] bg-[#FFE500]/10 text-[#FFE500] font-bold shadow-xs"
                  : "border-[#303432] bg-[#171919] text-[#A5A8A6] hover:border-[#FFE500]/40 hover:text-[#F5F5F0]"
              }`
            }
          >
            <n.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-auto bg-[#080909] p-6 text-[#F5F5F0]">
        <div className="mb-4">
          <Breadcrumbs current={title} />
        </div>
        {children}
      </main>
    </div>
  );
}
