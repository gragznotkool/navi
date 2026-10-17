import type { ModuleType } from "@opshub/contracts";

export interface ModuleColor {
  /** Card body. */
  bg: string;
  /** Header strip. */
  head: string;
  /** Border, port dots and the accent text. */
  accent: string;
  /** Title text (dark enough to read on `head`). */
  ink: string;
}

/** One light, distinct colour per module type, so the graph reads at a glance. */
export const MODULE_COLORS: Record<ModuleType, ModuleColor> = {
  "auth-rbac": { bg: "#F8FAFC", head: "#E2E8F0", accent: "#64748B", ink: "#1E293B" },
  "dashboard-shell": { bg: "#EEF2FF", head: "#E0E7FF", accent: "#6366F1", ink: "#312E81" },
  "user-management": { bg: "#FDF2F8", head: "#FCE7F3", accent: "#EC4899", ink: "#831843" },
  inventory: { bg: "#F0FDF4", head: "#DCFCE7", accent: "#22C55E", ink: "#14532D" },
  request: { bg: "#EFF6FF", head: "#DBEAFE", accent: "#3B82F6", ink: "#1E3A8A" },
  approval: { bg: "#FFFBEB", head: "#FEF3C7", accent: "#F59E0B", ink: "#78350F" },
  "material-assignment": { bg: "#F5F3FF", head: "#EDE9FE", accent: "#8B5CF6", ink: "#4C1D95" },
  "assignment-frontend": { bg: "#FAF5FF", head: "#F3E8FF", accent: "#A855F7", ink: "#581C87" },
  "consumption-tracking": { bg: "#F0FDFA", head: "#CCFBF1", accent: "#14B8A6", ink: "#134E4A" },
  "return-management": { bg: "#FFF1F2", head: "#FFE4E6", accent: "#F43F5E", ink: "#881337" },
  "pcb-repair": { bg: "#FFF7ED", head: "#FFEDD5", accent: "#F97316", ink: "#7C2D12" },
  "analytics-dashboard": { bg: "#ECFEFF", head: "#CFFAFE", accent: "#06B6D4", ink: "#164E63" },
  "reports-excel": { bg: "#F7FEE7", head: "#ECFCCB", accent: "#84CC16", ink: "#365314" },
};

const FALLBACK: ModuleColor = { bg: "#F8FAFC", head: "#E2E8F0", accent: "#94A3B8", ink: "#1E293B" };
export const moduleColor = (type: string): ModuleColor => MODULE_COLORS[type as ModuleType] ?? FALLBACK;
