import { ShieldAlert, TriangleAlert } from "lucide-react";
import type { PageDefinition } from "@opshub/contracts";
import { useSiteRuntime } from "./context";
import { LayoutFrame } from "./layouts";
import { resolveRenderer } from "./registry";

function Notice({ icon, title, children }: { icon: "forbidden" | "invalid"; title: string; children: string }) {
  const Icon = icon === "forbidden" ? ShieldAlert : TriangleAlert;
  return (
    <div role="alert" className="rounded-2xl border-2 border-[#1E293B] bg-white p-5 shadow-[4px_4px_0px_#1E293B]">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 text-[#FBBC04] shrink-0" aria-hidden />
        <div>
          <p className="font-['Outfit',sans-serif] text-base font-extrabold text-[#0F172A]">{title}</p>
          <p className="mt-1 text-sm font-medium text-slate-600">{children}</p>
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
      <Renderer node={node} page={page} layout={layout.type} />
    </LayoutFrame>
  );
}
