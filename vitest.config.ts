import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Depth-independent so nested checkouts (e.g. git worktrees under
// .claude/worktrees/) and Playwright specs are never collected.
const testExcludes = [
  ...configDefaults.exclude,
  "**/.claude/**",
  "**/tests/e2e/**",
  "**/*.spec.?(c|m)[jt]s?(x)",
  "**/playwright-report/**",
  "**/test-results/**",
];

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: testExcludes,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
        },
      },
    ],
  },
});
