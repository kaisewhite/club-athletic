/** Diagnostics accept identities/counts only; never provider messages or tool input. */
export function conversationDebugLog(_event: string, _fields: Record<string, unknown>): void {
  // Intentionally silent on the public trip deployment.
}

/** Server-side diagnostics use error class and safe codes only. Database and SDK
 * messages/stacks can include URLs, query values or credentials, so never log them. */
export function logChatFailure(stage: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : undefined;
  const safeStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const safeFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (["tool", "sourceSection", "kind", "method"].includes(key) &&
        typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(value)) {
      safeFields[key] = value;
    } else if (["conversationId", "requestId", "sessionId"].includes(key) &&
        typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)) {
      safeFields[key] = value;
    } else if (["consumed", "stale"].includes(key) &&
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      safeFields[key] = value;
    }
  }
  const detail = {
    name: error instanceof Error ? error.name : "NonError",
    ...(safeCode ? { code: safeCode } : {}),
    ...(safeStatus ? { status: safeStatus } : {}),
  };
  console.error(`[chat] ${stage} failed`, { ...safeFields, ...detail });
}
