import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default", "./tests/support/trust-reporter.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
