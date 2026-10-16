import { CURRENT_SCHEMA_VERSION } from "@opshub/contracts";

export type MigrationResult =
  | { ok: true; configuration: unknown }
  | { ok: false; code: string; message: string };

/**
 * Explicit configuration schema migrations, keyed by the version they upgrade FROM.
 * Each function must return a configuration at version `from + 1`.
 * No migrations exist yet because version 1 is the first schema version.
 */
const migrations: Record<number, (config: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateConfiguration(input: unknown): MigrationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "schema.not-object", message: "Configuration must be a JSON object" };
  }
  let current = input as Record<string, unknown>;
  let version = current.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, code: "schema.version-missing", message: "schemaVersion must be an integer" };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "schema.version-too-new",
      message: `schemaVersion ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}; upgrade the platform`,
    };
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) {
      return {
        ok: false,
        code: "schema.version-unsupported",
        message: `No migration path from schemaVersion ${version} to ${CURRENT_SCHEMA_VERSION}; re-create the configuration at the current version`,
      };
    }
    current = { ...step(current), schemaVersion: version + 1 };
    version += 1;
  }
  return { ok: true, configuration: current };
}
