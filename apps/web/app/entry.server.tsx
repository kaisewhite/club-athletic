import { renderToReadableStream } from "react-dom/server";
import { isRouteErrorResponse, ServerRouter, type EntryContext } from "react-router";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: request.signal,
      onError(error) {
        responseStatusCode = 500;
        if (!request.signal.aborted) console.error(error);
      },
    },
  );
  // These placeholder pages render completely before sending headers.
  await body.allReady;
  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}

/** React Router's default `handleError` logs every server error, internal 404
 * `ErrorResponse`s included, with a full stack trace. On a public trip page that
 * means every bot scanning `/robots.txt`, `/.well-known/*` or `/wp-login.php`
 * buries the real errors. A routing 404 is routine traffic, not a crash.
 *
 * Signature verified against react-router 7.18.1:
 * `HandleErrorFunction = (error: unknown, args: { request, context, params }) => void`. */
export function handleError(error: unknown, { request }: { request: Request }) {
  // The guest disconnected (closing a tab mid-SSE aborts the request). Nothing failed.
  if (request.signal.aborted) return;
  // A thrown Response the router turned into a client error: 404 for an unmatched
  // URL, 405 for a wrong method. These are already reported to the caller in the
  // response, so logging them as crashes adds noise and hides real failures.
  if (isRouteErrorResponse(error) && error.status < 500) return;
  // Everything else is a genuine server fault: log it with full detail.
  console.error(error);
}
