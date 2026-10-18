import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams, Link } from "react-router-dom";
import { websitePath } from "@opshub/contracts";
import { EmptyState, ErrorState, LoadingState, SkeletonLoader } from "../components/feedback";
import { useAsync } from "../hooks/useAsync";
import { sitesApi } from "../services";

const BuilderPage = lazy(() => import("../features/builder/BuilderPage").then((m) => ({ default: m.BuilderPage })));
const ReleasesPage = lazy(() => import("../features/releases/ReleasesPage").then((m) => ({ default: m.ReleasesPage })));
const RewindPage = lazy(() => import("../features/releases/RewindPage").then((m) => ({ default: m.RewindPage })));
import { setLastSite } from "../stores/lastSite";
import { useSession } from "../stores/session";
import { SiteRuntimeProvider } from "./context";
import { SiteShell } from "./SiteShell";
import { UniversalRenderer } from "./UniversalRenderer";
import { WebsiteShell } from "./WebsiteShell";
import { useSiteRuntime } from "./context";
import { usePreviewStore } from "../features/builder/previewStore";

/** Loads the ACTIVE release for the site named in the URL and provides it to the runtime. */
export function SiteRoute({ preview = false }: { preview?: boolean }) {
  const { slug = "" } = useParams();
  const session = useSession((s) => s.session);
  const membership = session?.memberships.find((m) => m.siteSlug === slug);
  const draft = usePreviewStore((s) => s.getDraft(slug));

  useEffect(() => {
    if (slug && !preview) setLastSite(slug);
  }, [preview, slug]);

  // Permissions are re-read with the config: they derive from the ACTIVE release's roles, so a
  // publish/rollback changes them and the login-time session snapshot would be stale.
  const active = useAsync(async () => {
    let siteId = membership?.siteId;
    if (!siteId) {
      const sites = await sitesApi.list();
      const match = sites.find((s) => s.slug === slug);
      if (match) siteId = match.id;
    }
    if (!siteId) return null;
    const [cfg, access] = await Promise.all([sitesApi.config(siteId), sitesApi.access(siteId)]);
    return { ...cfg, permissions: access.permissions, resolvedSiteId: siteId };
  }, [slug, membership?.siteId]);

  if (!membership && !active.data && !active.loading) {
    return (
      <div className="p-8">
        <EmptyState title="Site not found" hint="You are not a member of this site, or it does not exist." action={<Link className="mt-2 text-sm text-accent underline" to="/">Back to your sites</Link>} />
      </div>
    );
  }
  if (active.loading) return <div className="p-8"><LoadingState label="Loading site configuration…" /></div>;
  if (active.error || !active.data) return <div className="p-8"><ErrorState error={active.error} onRetry={active.reload} /></div>;
  if (preview && !draft) return <div className="p-8"><EmptyState title="No draft to preview" hint="Open the configuration builder and validate a draft first." action={<Link className="mt-2 text-sm text-accent underline" to={`/s/${slug}/admin/builder`}>Open builder</Link>} /></div>;

  const config = preview && draft ? draft : active.data.configuration;
  const siteId = active.data.resolvedSiteId || membership?.siteId || config.siteId;
  return (
    <SiteRuntimeProvider
      value={{
        siteId,
        slug,
        version: preview ? null : active.data.version,
        config,
        permissions: new Set(active.data.permissions),
        preview,
        basePath: preview ? `/preview/${slug}` : `/s/${slug}`,
        reload: active.reload,
      }}
    >
      <Routes>
        <Route index element={<FirstPage />} />
        {!preview && (
          <Route
            path="admin/builder"
            element={
              <SiteShell title="Configuration builder">
                <Suspense fallback={<div className="p-8"><SkeletonLoader rows={8} /></div>}>
                  <BuilderPage activeVersion={active.data.version} activeConfig={active.data.configuration} />
                </Suspense>
              </SiteShell>
            }
          />
        )}
        {!preview && (
          <Route
            path="admin/rewind"
            element={
              <SiteShell title="Rewind">
                <Suspense fallback={<div className="p-8"><SkeletonLoader rows={6} /></div>}>
                  <RewindPage />
                </Suspense>
              </SiteShell>
            }
          />
        )}
        {!preview && (
          <Route
            path="admin/releases"
            element={
              <SiteShell title="Releases">
                <Suspense fallback={<div className="p-8"><SkeletonLoader rows={6} /></div>}>
                  <ReleasesPage />
                </Suspense>
              </SiteShell>
            }
          />
        )}
        <Route path=":pagePath" element={<PageRoute />} />
      </Routes>
    </SiteRuntimeProvider>
  );
}

/**
 * Pages of a deployed website always render in the website's own theme. A live website opened at
 * /s/<slug> (site switcher, hub, bookmarks) moves to its canonical /w/<slug> address; a draft preview
 * stays on /preview but still uses the website shell. Admin screens keep the OpsHub shell.
 */
function PageShell({ title, path, children }: { title: string; path?: string; children: ReactNode }) {
  const { config, preview, slug } = useSiteRuntime();
  if (!config.website) return <SiteShell title={title}>{children}</SiteShell>;
  if (!preview) return <Navigate to={path ? `${websitePath(slug)}/${path}` : websitePath(slug)} replace />;
  return <WebsiteShell theme={config.website} title={title}>{children}</WebsiteShell>;
}

function FirstPage() {
  const { config, permissions, basePath } = useSiteRuntime();
  const first = config.navigation.map((n) => config.pages.find((p) => p.id === n.pageId)).find((p) => p && (!p.requiredPermission || permissions.has(p.requiredPermission)));
  if (!first) {
    return <PageShell title="No pages"><EmptyState title="No pages available" hint="Your role does not include access to any page in this site." /></PageShell>;
  }
  return <Navigate to={`${basePath}/${first.path}`} replace />;
}

function PageRoute() {
  const { pagePath } = useParams();
  const { config } = useSiteRuntime();
  const page = config.pages.find((p) => p.path === pagePath);
  if (!page) {
    return <PageShell title="Page not found"><EmptyState title="Page not found" hint={`This site has no page at “${pagePath}”.`} /></PageShell>;
  }
  return <PageShell title={page.title} path={page.path}><UniversalRenderer page={page} /></PageShell>;
}
