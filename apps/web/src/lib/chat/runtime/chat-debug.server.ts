/** Diagnostics accept identities/counts only; never provider messages or tool input. */
export function conversationDebugLog(_event: string, _fields: Record<string, unknown>): void {
  // Intentionally silent on the public trip deployment.
}

/** Server-side only, and deliberately unredacted. Guests still see PUBLIC_ERROR —
 * the trip page is public and unauthenticated — but a catch that tells nobody
 * anything is how a broken dependency survives in production, so the operator
 * gets the real cause in the process log. Never returned in a response body. */
export function logChatFailure(stage: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const cause = error instanceof Error && error.cause !== undefined ? { cause: String(error.cause) } : {};
  const detail = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack, ...cause }
    : { name: "NonError", message: typeof error === "string" ? error : JSON.stringify(error) };
  console.error(`[chat] ${stage} failed`, { ...fields, ...detail });
}
