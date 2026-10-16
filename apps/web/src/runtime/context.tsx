import { createContext, useContext } from "react";
import type { SiteConfiguration } from "@opshub/contracts";

export interface SiteRuntime {
  siteId: string;
  slug: string;
  version: number | null;
  config: SiteConfiguration;
  /** Permissions are for UX only (hiding controls); the API enforces them independently. */
  permissions: ReadonlySet<string>;
  /** True when rendering an unpublished draft from the builder. */
  preview: boolean;
  basePath: string;
  /** Re-fetches the active configuration (e.g. after publishing a new release). */
  reload: () => void;
}

const Ctx = createContext<SiteRuntime | null>(null);
export const SiteRuntimeProvider = Ctx.Provider;

export function useSiteRuntime(): SiteRuntime {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSiteRuntime must be used inside a site runtime");
  return v;
}
