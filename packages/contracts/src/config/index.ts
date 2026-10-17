import { z } from "zod";
import { moduleTypeSchema } from "../modules/index.js";
import { permissionSchema } from "../auth/index.js";
import { websiteThemeSchema } from "../websites/index.js";

export const CURRENT_SCHEMA_VERSION = 2;

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "must be a #RRGGBB color");

export const siteThemeSchema = z.object({
  primary: hexColor,
  secondary: hexColor,
});
export type SiteTheme = z.infer<typeof siteThemeSchema>;

export const siteShellTypeSchema = z.enum(["sidebar", "topbar", "workbench"]);
export type SiteShellType = z.infer<typeof siteShellTypeSchema>;

export const layoutTypeSchema = z.enum(["dashboard", "data-table", "kanban", "split-workspace"]);
export type LayoutType = z.infer<typeof layoutTypeSchema>;

const configValue = z.union([z.string(), z.number(), z.boolean()]);

export const moduleNodeSchema = z.object({
  id: z.string().min(1),
  moduleType: moduleTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.string(), configValue),
});
export type ModuleNode = z.infer<typeof moduleNodeSchema>;
/** A module enabled for a site is represented by its graph node. */
export type SiteModule = ModuleNode;

export const moduleEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string(),
  sourcePortId: z.string(),
  targetNodeId: z.string(),
  targetPortId: z.string(),
});
export type ModuleEdge = z.infer<typeof moduleEdgeSchema>;

export const siteGraphSchema = z.object({
  nodes: z.array(moduleNodeSchema),
  edges: z.array(moduleEdgeSchema),
});

export const layoutDefinitionSchema = z.object({
  id: z.string().min(1),
  type: layoutTypeSchema,
});
export type LayoutDefinition = z.infer<typeof layoutDefinitionSchema>;

export const pageDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.string().regex(/^[a-z0-9-]+$/, "path must be lowercase letters, digits and hyphens"),
  nodeId: z.string().min(1),
  layoutId: z.string().min(1),
  requiredPermission: permissionSchema.optional(),
});
export type PageDefinition = z.infer<typeof pageDefinitionSchema>;

export const roleDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  permissions: z.array(permissionSchema),
});
export type RoleDefinition = z.infer<typeof roleDefinitionSchema>;

export const navigationItemSchema = z.object({
  pageId: z.string().min(1),
  label: z.string().min(1),
});
export type NavigationItem = z.infer<typeof navigationItemSchema>;

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  initial: z.string().min(1),
  states: z.array(z.string().min(1)).min(1),
  transitions: z.array(
    z.object({ from: z.string(), to: z.string(), permission: permissionSchema.optional() }),
  ),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const calculatedFieldDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  expression: z.string().min(1),
  inputs: z.record(z.string(), z.enum(["number", "string", "boolean"])),
  resultType: z.enum(["number", "string", "boolean"]),
});
export type CalculatedFieldDefinition = z.infer<typeof calculatedFieldDefinitionSchema>;

export const customFieldDefinitionSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "field name must start with a letter and use letters, digits or _"),
  type: z.enum(["string", "number", "boolean", "date"]),
  required: z.boolean(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

/**
 * Excel report policy for one report key. Roles are role ids from `roles`.
 * `maskColumns` maps a role to the column keys it must not see (cells become "*** CONFIDENTIAL ***").
 */
export const reportDefinitionSchema = z.object({
  title: z.string().min(1),
  exportRoles: z.array(z.string().min(1)),
  importRoles: z.array(z.string().min(1)),
  maskColumns: z.record(z.string(), z.array(z.string().min(1))),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const fieldEntitySchema = z.enum(["inventory_item", "request_line"]);
export type FieldEntity = z.infer<typeof fieldEntitySchema>;

/** A configurable field on a domain entity. Hidden fields keep their stored values (soft-hide). */
export const fieldDefinitionSchema = z.object({
  id: z.string().min(1),
  entity: fieldEntitySchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "key must be lowercase letters, digits and underscores"),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "number", "boolean", "date"]),
  required: z.boolean().default(false),
  hidden: z.boolean().default(false),
});
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

export const siteConfigurationSchema = z.object({
  schemaVersion: z.number().int(),
  siteId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  theme: siteThemeSchema,
  shell: siteShellTypeSchema,
  layouts: z.array(layoutDefinitionSchema),
  modules: siteGraphSchema,
  pages: z.array(pageDefinitionSchema),
  roles: z.array(roleDefinitionSchema),
  navigation: z.array(navigationItemSchema),
  workflowDefinitions: z.array(workflowDefinitionSchema),
  calculatedFieldDefinitions: z.array(calculatedFieldDefinitionSchema),
  /** Configurable fields on domain entities (Schema v2). */
  fields: z.array(fieldDefinitionSchema).default([]),
  /** Extra per-module fields configured in the builder inspector. Absent in older releases. */
  customFields: z.array(customFieldDefinitionSchema).default([]),
  /** Keyed by report key (e.g. "inventory"). Absent in older releases, which therefore expose no reports. */
  reports: z.record(z.string().regex(/^[a-z0-9-]+$/), reportDefinitionSchema).default({}),
  /** Present on sites deployed from the website builder: their full visual identity. */
  website: websiteThemeSchema.optional(),
  metadata: z.record(z.string(), z.string()),
});
export type SiteConfiguration = z.infer<typeof siteConfigurationSchema>;

export const validationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  stage: z.string(),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const configurationValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(validationIssueSchema),
  warnings: z.array(validationIssueSchema),
});
export type ConfigurationValidationResult = z.infer<typeof configurationValidationResultSchema>;

export const configurationDraftSchema = z.object({
  /** Active release version the draft was based on; used for stale-draft detection. */
  baseVersion: z.number().int().nullable(),
  configuration: z.unknown(),
});
export type ConfigurationDraft = z.infer<typeof configurationDraftSchema>;

/** Body for validate / preview endpoints. */
export const configurationPayloadSchema = z.object({ configuration: z.unknown() });
export type ConfigurationPayload = z.infer<typeof configurationPayloadSchema>;
