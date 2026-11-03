import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup/test-env.ts"],
    // Boots anvil + deploys contracts once per run; addresses reach tests via inject("anvil").
    globalSetup: ["tests/setup/anvil.ts"],
    // All chain tests share one anvil and some fast-forward its clock, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
