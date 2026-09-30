import type { ReactNode } from "react";
import { isRouteErrorResponse, Links, Meta, Scripts } from "react-router";
import { AppShell } from "./components/app-shell";
import type { Route } from "./+types/root";
import "@/styles.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        {/* TODO §2.15 mobile mechanics. `viewport-fit=cover` is what makes the
            `env(safe-area-inset-*)` paddings in the mobile blocks of
            `src/styles.css` resolve to anything on a notched phone;
            `interactive-widget=resizes-content` shrinks the layout viewport when
            the soft keyboard opens, so the sticky composer rides above it — this
            is the declarative replacement for a `visualViewport` resize listener,
            and no such JS exists in this app. Desktop ignores all three. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
        <title>Méribel ’27 — Club Athletic</title>
        {/* Without this, every browser visit requests `/favicon.ico`, misses static
            serving and reaches the SSR handler as a 404. */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <AppShell />;
}

/** Without a root `ErrorBoundary`, React Router renders its built-in
 * `RemixRootDefaultErrorBoundary`, which `console.error`s the error itself while
 * rendering. That is the second half of the `/favicon.ico` log spam: `handleError`
 * in `app/entry.server.tsx` silences the request-handler log, but the default
 * boundary keeps printing the `ErrorResponseImpl` for every unmatched URL. Owning
 * the boundary removes that log and gives guests a real page instead of React
 * Router's developer fallback. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const routeError = isRouteErrorResponse(error);
  const status = routeError ? error.status : 500;
  const heading = routeError && status === 404 ? "Page not found" : "Something went wrong";
  // Never render a raw error: this page is public and unauthenticated, and the
  // message can carry a connection string, a PNR or a stack path. The operator
  // gets the real cause from `handleError` in the process log instead.
  return (
    <main className="page-route">
      <div className="route-content">
        <h2>{heading}<span className="text-accent">.</span></h2>
        <p className="page-sub">
          {status === 404
            ? "That link is not part of the trip page."
            : "Please try again in a moment."}
        </p>
        <p style={{ marginTop: 20 }}><a className="text-accent" href="/">Back to the trip overview</a></p>
      </div>
    </main>
  );
}
