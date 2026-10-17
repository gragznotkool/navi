import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

let embedded: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

/**
 * Integration tests need a real PostgreSQL (RLS, triggers, locking). Use TEST_DATABASE_ADMIN_URL
 * (e.g. the CI service container) when set; otherwise start a throwaway embedded PostgreSQL 16.
 */
export async function setup(): Promise<void> {
  if (process.platform === "win32") {
    process.env.PATH = `${process.env.PATH};C:\\Windows\\System32;C:\\Windows`;
    process.env.Path = `${process.env.Path};C:\\Windows\\System32;C:\\Windows`;
  }
  const appPassword = "test-app-password";
  if (process.env.TEST_DATABASE_ADMIN_URL) {
    const admin = new URL(process.env.TEST_DATABASE_ADMIN_URL);
    const app = new URL(admin.toString());
    app.username = "opshub_app";
    app.password = appPassword;
    process.env.TEST_ADMIN_URL = admin.toString();
    process.env.TEST_APP_URL = app.toString();
    return;
  }
  dataDir = mkdtempSync(join(tmpdir(), "opshub-pg-"));
  const port = 54000 + Math.floor(Math.random() * 900);
  embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "opshub_admin",
    password: "test-admin-password",
    port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await embedded.initialise();
  await embedded.start();
  await embedded.createDatabase("opshub_test");
  process.env.TEST_ADMIN_URL = `postgres://opshub_admin:test-admin-password@localhost:${port}/opshub_test`;
  process.env.TEST_APP_URL = `postgres://opshub_app:${appPassword}@localhost:${port}/opshub_test`;
}

export async function teardown(): Promise<void> {
  await embedded?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}
