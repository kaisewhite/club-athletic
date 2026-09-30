import { createRequestHandler } from "@react-router/express";
import express from "express";

import { recoverRunningManagedAgentConversations, shutdownChatRuntime } from "../src/lib/chat/runtime/runtime.server";
import { startUploadMaintenance, stopUploadMaintenance } from "../src/lib/chat/upload-maintenance.server";
import { shutdownChatStreams } from "../src/lib/chat/runtime/http.server";

let recovery: Promise<void> | undefined;
export function startChatRuntime() {
  startUploadMaintenance();
  return recovery ??= recoverRunningManagedAgentConversations().catch(() => {
    console.error("Chat startup recovery unavailable; read-time recovery remains enabled.");
  });
}
export async function stopChatRuntime() {
  try { await shutdownChatRuntime(); }
  finally { await Promise.all([shutdownChatStreams(), stopUploadMaintenance()]); }
}
export const app = express();
app.use((request, _response, next) => {
  // Overwrite any guest-supplied key, using the actual connection address.
  request.headers["x-club-chat-client"] = request.socket.remoteAddress ?? "shared-public";
  next();
});

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    mode: process.env.NODE_ENV === "development" ? "development" : "production",
  }),
);
