import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const playwrightExcludes = [
  ...configDefaults.exclude,
  "tests/e2e/**",
  "playwright-report/**",
  "test-results/**",
];

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: playwrightExcludes,
  },
  projects: [
    {
      test: {
        name: "node",
        environment: "node",
        include: ["tests/**/*.test.ts"],
        exclude: playwrightExcludes,
      },
    },
    {
      test: {
        name: "components",
        environment: "jsdom",
        include: ["tests/components/**/*.test.tsx"],
        exclude: playwrightExcludes,
      },
    },
  ],
} as any);
