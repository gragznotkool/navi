import type { ReactNode } from "react";
import type { LayoutType } from "@opshub/contracts";

/** Page frames. The module component decides how to present data for the active layout type. */
const frames: Record<LayoutType, (p: { children: ReactNode }) => ReactNode> = {
  dashboard: ({ children }) => <div className="mx-auto w-full max-w-6xl">{children}</div>,
  "data-table": ({ children }) => <div className="w-full">{children}</div>,
  kanban: ({ children }) => <div className="w-full overflow-x-auto">{children}</div>,
  "split-workspace": ({ children }) => <div className="w-full">{children}</div>,
};

export function LayoutFrame({ type, children }: { type: LayoutType; children: ReactNode }) {
  const Frame = frames[type];
  return <div data-layout={type}>{Frame({ children })}</div>;
}
