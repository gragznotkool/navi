import { defineConfig } from "vitest/config";

// Integration tests share one PostgreSQL instance and reset it per file, so files run serially.
export default defineConfig({
  test: {
    reporters: ["default", "./tests/support/trust-reporter.ts"],
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
