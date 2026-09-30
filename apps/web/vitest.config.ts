import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          unstubGlobals: true,
          unstubEnvs: true,
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["tests/components/**/*.test.tsx", "tests/routes/**/*.test.tsx"],
        },
      },
    ],
  },
});
