import { z } from "zod";

export const moduleTypeSchema = z.enum([
  "auth-rbac",
  "user-management",
  "inventory",
  "dashboard-shell",
  "request",
  "approval",
  "material-assignment",
  "assignment-frontend",
  "consumption-tracking",
  "return-management",
  "pcb-repair",
  "analytics-dashboard",
  "reports-excel",
]);
export type ModuleType = z.infer<typeof moduleTypeSchema>;

export const dataTypeDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Other data types this type may be connected into (a type is always compatible with itself). */
  assignableTo: z.array(z.string()),
});
export type DataTypeDefinition = z.infer<typeof dataTypeDefinitionSchema>;

export const portDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  direction: z.enum(["input", "output"]),
  dataType: z.string(),
});
export type PortDefinition = z.infer<typeof portDefinitionSchema>;

export const moduleCategorySchema = z.enum(["platform", "core", "workflow", "analytics"]);

export const moduleImplementationStatusSchema = z.enum(["implemented", "partial", "contract-only"]);

export const moduleConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean(),
});

export const moduleDefinitionSchema = z.object({
  type: moduleTypeSchema,
  displayName: z.string(),
  category: moduleCategorySchema,
  description: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  ports: z.array(portDefinitionSchema),
  dependencies: z.array(moduleTypeSchema),
  /** Per-node configuration fields accepted by this module (the module's config schema). */
  configFields: z.array(moduleConfigFieldSchema),
  permissions: z.array(z.string()),
  defaults: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  platformModule: z.boolean(),
  frontendRenderer: z.string(),
  backendService: z.string(),
  implementationStatus: moduleImplementationStatusSchema,
});
export type ModuleDefinition = z.infer<typeof moduleDefinitionSchema>;
