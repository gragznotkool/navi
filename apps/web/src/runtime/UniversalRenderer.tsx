import { ShieldAlert, TriangleAlert } from "lucide-react";
import { Suspense } from "react";
import { LoadingState } from "../components/feedback";
import type { PageDefinition } from "@opshub/contracts";
import { useSiteRuntime } from "./context";
import { LayoutFrame } from "./layouts";
import { resolveRenderer } from "./registry";

function Notice({ icon, title, children }: { icon: "forbidden" | "invalid"; title: string; children: string }) {
  const Icon = icon === "forbidden" ? ShieldAlert : TriangleAlert;
  return (
    <div role="alert" className="rounded-ui border border-line bg-surface p-4">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 text-warning" aria-hidden />
        <div>
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-sm text-muted">{children}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders one configured page: resolves its node and layout from the active configuration, checks
 * role-based visibility, then delegates to the registered module component. It never branches on a
 * site slug and never evaluates anything from configuration.
 */
export function UniversalRenderer({ page }: { page: PageDefinition }) {
  const { config, permissions } = useSiteRuntime();
  const node = config.modules.nodes.find((n) => n.id === page.nodeId);
  const layout = config.layouts.find((l) => l.id === page.layoutId);

  if (!node || !layout) {
    return <Notice icon="invalid" title="Invalid page configuration">{`Page "${page.title}" references a module or layout that does not exist in this configuration.`}</Notice>;
  }
  if (page.requiredPermission && !permissions.has(page.requiredPermission)) {
    return <Notice icon="forbidden" title="Access restricted">{`Your role does not include the "${page.requiredPermission}" permission.`}</Notice>;
  }
  const Renderer = resolveRenderer(node.moduleType);
  if (!Renderer) {
    return <Notice icon="invalid" title="Unsupported module">{`This client has no renderer for module type "${node.moduleType}". Update the application or change the configuration.`}</Notice>;
  }
  return (
    <LayoutFrame type={layout.type}>
      <Suspense fallback={<LoadingState />}>
        <Renderer node={node} page={page} layout={layout.type} />
      </Suspense>
    </LayoutFrame>
  );
}
