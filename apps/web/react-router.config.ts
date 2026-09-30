import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  future: {
    // Build-time bundling only; no runtime behaviour change for our routes.
    v8_splitRouteModules: true,
    // We match no `.data` URL patterns and front no CDN, so the new
    // trailing-slash-aware data request format changes nothing for us.
    v8_trailingSlashAwareDataRequests: true,
    // The v8 breakage is `getLoadContext` in a custom server, or `context` in a
    // loader/action. We have neither: `server/app.ts` calls
    // `createRequestHandler` with only `build` and `mode`, and no route module
    // reads `context`.
    v8_middleware: true,
    // `vite.config.ts` no longer uses `isSsrBuild`; the SSR rollup input moved to
    // `environments.ssr.build.rollupOptions`, which is what this flag requires.
    v8_viteEnvironmentApi: true,
    // High risk per the docs, but the documented breakage is comparing a request
    // pathname. Our only three `new URL(request.url)` uses compare `.origin` /
    // `.host` or read our own `after` search param, never a pathname. Proven live
    // against the SSE stream and the multipart upload route.
    v8_passThroughRequests: true,
  },
} satisfies Config;
