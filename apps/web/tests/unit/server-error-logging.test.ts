import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleError } from "../../app/entry.server";

/** React Router's `isRouteErrorResponse` is a structural check
 * (`status` number, `statusText` string, `internal` boolean, a `data` key), so
 * this is the same shape the router hands `handleError` for an internal 404. */
function errorResponse(status: number, url: string) {
  return {
    status,
    statusText: status === 404 ? "Not Found" : "Error",
    internal: true,
    data: `Error: No route matches URL "${url}"`,
    error: new Error(`No route matches URL "${url}"`),
  };
}
const args = (init?: { aborted?: boolean }) => {
  const controller = new AbortController();
  if (init?.aborted) controller.abort();
  return { request: new Request("https://trip.test/favicon.ico", { signal: controller.signal }), context: {}, params: {} };
};

afterEach(() => vi.restoreAllMocks());

describe("handleError", () => {
  it("does not log a routine 404 as a crash", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleError(errorResponse(404, "/favicon.ico"), args());
    handleError(errorResponse(404, "/robots.txt"), args());
    handleError(errorResponse(404, "/wp-login.php"), args());
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays quiet for every client error, not just 404", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [400, 403, 405, 410, 413, 429, 499]) handleError(errorResponse(status, "/x"), args());
    expect(spy).not.toHaveBeenCalled();
  });

  it("still logs a real server error with the error itself, not a redaction", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("Prisma pool exhausted");
    handleError(boom, args());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(boom);
    // The operator needs the stack, so the whole Error object is passed through.
    expect((spy.mock.calls[0]![0] as Error).stack).toBeTruthy();
  });

  it("logs a 5xx thrown as a Response — those are server faults, not routine traffic", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleError(errorResponse(500, "/"), args());
    handleError(errorResponse(503, "/"), args());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not log when the guest disconnected mid-request (aborted SSE)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleError(new Error("The operation was aborted"), args({ aborted: true }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the existing render-failure `onError` in handleRequest", () => {
    // `handleError` covers the request handler; render failures are reported by
    // `renderToReadableStream`'s own `onError`, which must not be removed.
    const source = readFileSync(resolve(import.meta.dirname, "../../app/entry.server.tsx"), "utf8");
    expect(source).toContain("onError(error)");
    expect(source).toContain("if (!request.signal.aborted) console.error(error);");
  });
});

describe("root ErrorBoundary", () => {
  it("is exported, so React Router's default boundary cannot console.error every 404", async () => {
    // RemixRootDefaultErrorBoundary calls console.error(error) while rendering.
    // Owning the boundary is what makes an unmatched URL fully silent.
    const root = (await import("../../app/root")) as Record<string, unknown>;
    expect(typeof root.ErrorBoundary).toBe("function");
  });

  it("never renders the raw error on a public, unauthenticated page", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../app/root.tsx"), "utf8");
    const boundary = source.slice(source.indexOf("export function ErrorBoundary"));
    expect(boundary).not.toMatch(/\{\s*(?:String\()?error(?:\)|\s*\.\s*(?:message|stack))/);
  });
});
