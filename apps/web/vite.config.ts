import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    reactRouter(),
    // React Router 7 owns Fast Refresh in development; do not install it twice.
    ...(command === "build" ? [react()] : []),
  ],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: { allowedHosts: ["host.docker.internal"] },
  // `future.v8_viteEnvironmentApi` removes the `isSsrBuild` flag this input was
  // previously gated on; the SSR input now belongs to the `ssr` environment.
  environments: {
    ssr: { build: { rollupOptions: { input: "./server/app.ts" } } },
  },
}));
