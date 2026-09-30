import express, { type Express } from "express";
import { resolve } from "node:path";
import { createServer } from "node:http";
import type { ViteDevServer } from "vite";
import { loadEnv } from "./server/env";

const env = loadEnv();
const webPort = env.PORT;
const development = process.env.NODE_ENV === "development";
const app = express();
const server = createServer(app);
let vite: ViteDevServer | undefined;
let shuttingDown = false;
let stopChatRuntime: (() => Promise<void>) | undefined;

app.disable("x-powered-by");

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  await stopChatRuntime?.();
  await Promise.all([
    new Promise<void>((done) => server.close(() => done())),
    vite?.close(),
  ]);
  clearTimeout(deadline);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  if (development) {
    // TWO watchers need polling here, for two different reasons. Setting only one
    // of these looks like it works and silently costs you the other half.
    //
    // 1. The plugin's watcher, via the env vars. Bun on macOS deadlocks chokidar's
    //    native FSEvents backend: the watcher the React Router dev plugin starts
    //    inside Vite's `configResolved` never settles, so `createViteServer` never
    //    resolves and this server never listens. chokidar reads these variables
    //    when it constructs a watcher, so they must be set before Vite and its
    //    plugins are imported. `server.watch` cannot reach this watcher.
    // 2. Vite's own dev-server watcher, via `server.watch` below. The env vars
    //    leave it constructed and watching the right directories but INERT — it
    //    never emits a `change`, so nothing is ever HMR'd and every CSS edit looks
    //    like it needs a server restart. Measured: env vars alone -> 0 change
    //    events; with the explicit config -> fires on `src/styles.css`.
    if (process.platform === "darwin" && process.versions.bun) {
      process.env.CHOKIDAR_USEPOLLING ??= "1";
      process.env.CHOKIDAR_INTERVAL ??= "300";
    }
    const { createServer: createViteServer } = await import("vite");
    const devServer = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
        ...(process.platform === "darwin" && process.versions.bun
          ? { watch: { usePolling: true, interval: 300 } }
          : {}),
      },
      appType: "custom",
    });
    vite = devServer;
    const runtimeModule = (await devServer.ssrLoadModule("./server/app.ts")) as typeof import("./server/app");
    stopChatRuntime = runtimeModule.stopChatRuntime;
    await runtimeModule.startChatRuntime();
    app.use(devServer.middlewares);
    app.use(async (request, response, next) => {
      try {
        // Vite erases module exports; this path loads our known Express app export.
        const module = (await devServer.ssrLoadModule("./server/app.ts")) as typeof import("./server/app");
        module.app(request, response, next);
      } catch (error) {
        if (error instanceof Error) devServer.ssrFixStacktrace(error);
        next(error);
      }
    });
  } else {
    const clientDir = resolve(import.meta.dirname, "build/client");
    app.use("/assets", express.static(resolve(clientDir, "assets"), {
      immutable: true,
      maxAge: "1y",
    }));
    app.use(express.static(clientDir, { maxAge: "1h" }));
    // Variable import keeps generated output out of source typechecking.
    const buildPath = "./build/server/index.js";
    const module: { app: Express; startChatRuntime(): Promise<void>; stopChatRuntime(): Promise<void> } = await import(buildPath);
    stopChatRuntime = module.stopChatRuntime;
    await module.startChatRuntime();
    app.use(module.app);
  }

  server.once("error", async (error) => {
    console.error(error.message);
    await stopChatRuntime?.();
    await vite?.close();
    process.exit(1);
  });
  server.listen(webPort, () => {
    console.log(`Club Athletic running on http://localhost:${webPort}`);
  });
} catch (error) {
  await stopChatRuntime?.();
  await vite?.close();
  throw error;
}
