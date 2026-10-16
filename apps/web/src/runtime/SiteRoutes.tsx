import { useEffect } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/feedback";
import { useAsync } from "../hooks/useAsync";
import { BuilderPage } from "../features/builder/BuilderPage";
import { ReleasesPage } from "../features/releases/ReleasesPage";
import { RewindPage } from "../features/releases/RewindPage";
import { sitesApi } from "../services";
import { setLastSite } from "../stores/lastSite";
import { useSession } from "../stores/session";
import { SiteRuntimeProvider } from "./context";
import { SiteShell } from "./SiteShell";
import { UniversalRenderer } from "./UniversalRenderer";
import { useSiteRuntime } from "./context";
import { Link } from "react-router-dom";
import { usePreviewStore } from "../features/builder/previewStore";

/** Loads the ACTIVE release for the site named in the URL and provides it to the runtime. */
export function SiteRoute({ preview = false }: { preview?: boolean }) {
  const { slug = "" } = useParams();
  const session = useSession((s) => s.session);
  const membership = session?.memberships.find((m) => m.siteSlug === slug);
  const draft = usePreviewStore((s) => s.drafts[slug]);
  useEffect(() => {
    if (membership && !preview) setLastSite(slug);
  }, [membership, preview, slug]);
  // Permissions are re-read with the config: they derive from the ACTIVE release's roles, so a
  // publish/rollback changes them and the login-time session snapshot would be stale.
  const active = useAsync(async () => {
    if (!membership) return null;
    const [cfg, access] = await Promise.all([sitesApi.config(membership.siteId), sitesApi.access(membership.siteId)]);
    return { ...cfg, permissions: access.permissions };
  }, [membership?.siteId]);

  if (!membership) {
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
  return (
    <SiteRuntimeProvider
      value={{
        siteId: membership.siteId,
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
        {!preview && <Route path="admin/builder" element={<SiteShell title="Configuration builder"><BuilderPage activeVersion={active.data.version} activeConfig={active.data.configuration} /></SiteShell>} />}
        {!preview && <Route path="admin/rewind" element={<SiteShell title="Rewind"><RewindPage /></SiteShell>} />}
        {!preview && <Route path="admin/releases" element={<SiteShell title="Releases"><ReleasesPage /></SiteShell>} />}
        <Route path=":pagePath" element={<PageRoute />} />
      </Routes>
    </SiteRuntimeProvider>
  );
}

function FirstPage() {
  const { config, permissions, basePath } = useSiteRuntime();
  const first = config.navigation.map((n) => config.pages.find((p) => p.id === n.pageId)).find((p) => p && (!p.requiredPermission || permissions.has(p.requiredPermission)));
  if (!first) {
    return <SiteShell title="No pages"><EmptyState title="No pages available" hint="Your role does not include access to any page in this site." /></SiteShell>;
  }
  return <Navigate to={`${basePath}/${first.path}`} replace />;
}

function PageRoute() {
  const { pagePath } = useParams();
  const { config } = useSiteRuntime();
  const page = config.pages.find((p) => p.path === pagePath);
  if (!page) {
    return <SiteShell title="Page not found"><EmptyState title="Page not found" hint={`This site has no page at “${pagePath}”.`} /></SiteShell>;
  }
  return <SiteShell title={page.title}><UniversalRenderer page={page} /></SiteShell>;
}
