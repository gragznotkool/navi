import { Lock } from "lucide-react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { getWebsiteTheme, type WebsiteTheme } from "@opshub/contracts";
import { EmptyState, ErrorState, LoadingState } from "../components/feedback";
import { useAsync } from "../hooks/useAsync";
import { sitesApi } from "../services";
import { useSession } from "../stores/session";
import { SiteRuntimeProvider, useSiteRuntime } from "./context";
import { UniversalRenderer } from "./UniversalRenderer";
import { WebsiteShell } from "./WebsiteShell";

const FALLBACK_THEME = getWebsiteTheme("ocean-breeze")!;

function NoAccess({ slug }: { slug: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[#F8FAFC] p-6 text-[#1E293B]">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#DC2626]">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <p className="mt-4 text-xs font-semibold tracking-wide text-[#DC2626]">403 · ACCESS RESTRICTED</p>
        <h1 className="mt-1 text-xl font-semibold">You don’t have access to this website</h1>
        <p className="mt-2 text-sm text-[#64748B]">
          <span className="font-mono">/w/{slug}</span> is limited to specific people. Ask its administrator to add you.
        </p>
        <Link to="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-[#1E293B] px-4 text-sm font-medium text-white hover:bg-[#0F172A]">Back to OpsHub</Link>
      </div>
    </div>
  );
}

/**
 * Loads a deployed website's ACTIVE release and renders it with its own theme. Access is
 * membership: a user who is not a member of the site sees a 403, and the API refuses its data too.
 */
export function WebsiteRoute() {
  const { slug = "" } = useParams();
  const session = useSession((s) => s.session);
  const membership = session?.memberships.find((m) => m.siteSlug === slug);

  const active = useAsync(async () => {
    let siteId = membership?.siteId;
    if (!siteId) siteId = (await sitesApi.list()).find((s) => s.slug === slug)?.id;
    if (!siteId) return null;
    const [cfg, access] = await Promise.all([sitesApi.config(siteId), sitesApi.access(siteId)]);
    return { ...cfg, permissions: access.permissions, siteId };
  }, [slug, membership?.siteId]);

  if (active.loading) return <div className="p-8"><LoadingState label="Opening website…" /></div>;
  if (active.error) return <div className="p-8"><ErrorState error={active.error} onRetry={active.reload} /></div>;
  if (!active.data) return <NoAccess slug={slug} />;

  const { configuration: config, version, permissions, siteId } = active.data;
  // A site not deployed from the website builder still opens, in the default website theme.
  const theme = config.website ?? FALLBACK_THEME;
  const basePath = `/w/${slug}`;
  return (
    <SiteRuntimeProvider value={{ siteId, slug, version, config, permissions: new Set(permissions), preview: false, basePath, reload: active.reload }}>
      <Routes>
        <Route index element={<FirstPage theme={theme} />} />
        <Route path=":pagePath" element={<Page theme={theme} />} />
      </Routes>
    </SiteRuntimeProvider>
  );
}

function FirstPage({ theme }: { theme: WebsiteTheme }) {
  const { config, permissions, basePath } = useSiteRuntime();
  const first = config.navigation.map((n) => config.pages.find((p) => p.id === n.pageId)).find((p) => p && (!p.requiredPermission || permissions.has(p.requiredPermission)));
  if (!first) return <WebsiteShell theme={theme} title="Welcome"><EmptyState title="No pages available" hint="Your role does not include access to any page of this website." /></WebsiteShell>;
  return <Navigate to={`${basePath}/${first.path}`} replace />;
}

function Page({ theme }: { theme: WebsiteTheme }) {
  const { pagePath } = useParams();
  const { config } = useSiteRuntime();
  const page = config.pages.find((p) => p.path === pagePath);
  if (!page) return <WebsiteShell theme={theme} title="Page not found"><EmptyState title="Page not found" hint={`This website has no page at “${pagePath}”.`} /></WebsiteShell>;
  return <WebsiteShell theme={theme} title={page.title}><UniversalRenderer page={page} /></WebsiteShell>;
}
