import { lazy, Suspense, type ComponentType } from "react";
import type { LayoutType, ModuleNode, ModuleType, PageDefinition } from "@opshub/contracts";
import { SkeletonLoader } from "../../components/feedback";
import { ApprovalsModule } from "../../features/approvals/ApprovalsModule";
import { AssignmentsModule } from "../../features/assignments/AssignmentsModule";
import { ConsumptionModule } from "../../features/assignments/ConsumptionModule";
import { InventoryModule } from "../../features/inventory/InventoryModule";
import { RequestsModule } from "../../features/requests/RequestsModule";
import { PcbRepairModule } from "../../features/pcb-repair/PcbRepairModule";
import { ReturnsModule } from "../../features/returns/ReturnsModule";
import { ReportsModule } from "../../features/reports/ReportsModule";
import { DashboardModule } from "../pages/DashboardModule";
import { UnavailableModule } from "../pages/UnavailableModule";

const LazyAnalyticsModule = lazy(() => import("../../features/analytics/AnalyticsModule").then((m) => ({ default: m.AnalyticsModule })));
const AnalyticsRenderer: ComponentType<ModuleProps> = (props) => (
  <Suspense fallback={<SkeletonLoader rows={6} />}>
    <LazyAnalyticsModule {...props} />
  </Suspense>
);

export interface ModuleProps {
  node: ModuleNode;
  page: PageDefinition;
  layout: LayoutType;
}

const unavailable = (title: string, reason: string): ComponentType<ModuleProps> =>
  function Unavailable() {
    return <UnavailableModule title={title} reason={reason} />;
  };

/**
 * Module type -> React component. This is the ONLY place module types map to UI; configuration can
 * only select from these registered components, never supply code. Keys are typed against the
 * contract's ModuleType so a new module cannot be added to the contract without a renderer decision.
 */
export const rendererRegistry: Record<ModuleType, ComponentType<ModuleProps>> = {
  "auth-rbac": unavailable("Authentication and RBAC", "Managed by the platform; it has no page of its own."),
  "dashboard-shell": DashboardModule,
  "user-management": unavailable("User management", "Contract defined; the user administration screens and API are not built yet."),
  inventory: InventoryModule,
  request: RequestsModule,
  approval: ApprovalsModule,
  "material-assignment": AssignmentsModule,
  "assignment-frontend": AssignmentsModule,
  "consumption-tracking": ConsumptionModule,
  "return-management": ReturnsModule,
  "pcb-repair": PcbRepairModule,
  "analytics-dashboard": AnalyticsRenderer,
  "reports-excel": ReportsModule,
};

export function resolveRenderer(moduleType: string): ComponentType<ModuleProps> | null {
  return (Object.prototype.hasOwnProperty.call(rendererRegistry, moduleType) ? rendererRegistry[moduleType as ModuleType] : null) ?? null;
}
