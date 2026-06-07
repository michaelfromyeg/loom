import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/index.ts",
        "packages/schema/scripts/**",
        // Pure type/interface modules with no runtime code.
        "packages/adapter-kit/src/adapter.ts",
        "packages/adapter-kit/src/catalog.ts",
        "packages/adapter-kit/src/driver.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
