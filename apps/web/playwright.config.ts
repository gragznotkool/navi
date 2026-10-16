import { defineConfig } from "@playwright/test";

// Starts (or reuses) PostgreSQL, the API and the web dev server. Needs a local .env (copy .env.example).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: [
    { command: "npm run db:embedded -w @opshub/api", cwd: "../..", port: 5432, reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev -w @opshub/api", cwd: "../..", url: "http://localhost:4000/api/v1/ready", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev -w @opshub/web", cwd: "../..", url: "http://localhost:5173", reuseExistingServer: true, timeout: 120_000 },
  ],
});
