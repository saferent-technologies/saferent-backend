import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Makes TEST_DATABASE_URL from server/.env available to the integration tests.
    env: { TEST_DATABASE_URL: loadEnv(mode, process.cwd(), "").TEST_DATABASE_URL ?? "" },
    testTimeout: 30_000,
  },
}));
