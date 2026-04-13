import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
  projects: [
    {
      test: {
        name: "node",
        environment: "node",
        include: ["tests/**/*.test.ts"],
      },
    },
    {
      test: {
        name: "components",
        environment: "jsdom",
        include: ["tests/components/**/*.test.tsx"],
      },
    },
  ],
} as any);
