import { CUSTOM_TEMPLATE_ID, websitePath, type WebsiteDeployRequest, type WebsiteDeployResponse } from "@opshub/contracts";
import { loadPresets } from "../provisioning/presets.js";
import { requestProvisioning, type ProvisionActor, type ProvisionDeps } from "../provisioning/service.js";
import { AppError } from "../utils/errors.js";
import { resolveAccessUserIds } from "./access.js";
import { getWebsiteTemplate, themedConfiguration } from "./templates.js";

/**
 * Deploys a website through the one-save provisioning pipeline: site record, compile + validate,
 * release v1, administrators and visitors, all in one transaction. The client's configuration is a
 * candidate only; the compiler decides, and identity and theme are applied by the server.
 */
export async function deployWebsite(deps: ProvisionDeps, actor: ProvisionActor, body: WebsiteDeployRequest): Promise<WebsiteDeployResponse> {
  // "custom" is a graph assembled freely in the Modules tab; any preset serves as the job's label.
  const template = body.templateId === CUSTOM_TEMPLATE_ID ? { name: "Custom", presetId: loadPresets()[0]?.id ?? "" } : getWebsiteTemplate(body.templateId);
  if (!template) throw new AppError(422, "unknown_template", `Unknown website template “${body.templateId}”`);

  const userIds = await resolveAccessUserIds(deps.db, body.access);
  const configuration = themedConfiguration(body.configuration, body.theme);
  const { job, created } = await requestProvisioning(
    deps,
    actor,
    { slug: body.slug, name: body.name, preset: template.presetId, demoStock: true },
    { configuration, members: { userIds, roleKey: body.access.roleId }, sourceLabel: `${template.name} · ${body.theme.name}` },
  );
  return { jobId: job.id, slug: job.slug, path: websitePath(job.slug), created };
}
