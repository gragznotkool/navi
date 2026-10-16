import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { SiteConfiguration } from "@opshub/contracts";
import { SiteRuntimeProvider } from "../src/runtime/context";
import central from "../../../config/sites/central-stores.json";
import service from "../../../config/sites/service-centre.json";
import distribution from "../../../config/sites/distribution.json";

export const configs = {
  central: central as SiteConfiguration,
  service: service as SiteConfiguration,
  distribution: distribution as SiteConfiguration,
};

export function renderInSite(
  ui: ReactElement,
  opts: { config: SiteConfiguration; permissions: string[]; route?: string; preview?: boolean },
) {
  return render(
    <MemoryRouter initialEntries={[opts.route ?? "/"]}>
      <SiteRuntimeProvider
        value={{
          siteId: opts.config.siteId,
          slug: opts.config.slug,
          version: 1,
          config: opts.config,
          permissions: new Set(opts.permissions),
          preview: opts.preview ?? false,
          basePath: `/s/${opts.config.slug}`,
          reload: () => undefined,
        }}
      >
        {ui}
      </SiteRuntimeProvider>
    </MemoryRouter>,
  );
}

export const allPermissions = (c: SiteConfiguration): string[] => [...new Set(c.roles.flatMap((r) => r.permissions))];
