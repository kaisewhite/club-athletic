/**
 * `/robots.txt`.
 *
 * This is worth serving rather than 404ing, for one reason that is about the
 * content and one that is about the logs.
 *
 * The content reason is the stronger one. This is an unlisted page for a private
 * trip: it is unauthenticated so that nine guests can open a link without an
 * account, but it is not meant to be discoverable. It carries guest names, a
 * chalet address, flight times and a shuttle schedule. A 404 here is not neutral
 * — a crawler that cannot read a robots.txt treats the whole origin as
 * crawlable, so the trip page can be indexed and then survive in search results
 * and caches long after the trip. `Disallow: /` is the only standard way to ask
 * every well-behaved crawler not to do that. It is a request, not access
 * control, which is exactly the right strength for this: nothing here relies on
 * it, and it does not pretend to protect anything.
 *
 * The log reason is secondary: bots ask for this path constantly, and every miss
 * used to reach the SSR handler and log a 404 stack trace. `handleError` in
 * `app/entry.server.tsx` is what actually makes unmatched paths quiet — this
 * route does not exist to silence anything, and `/.well-known/*` and
 * `/wp-login.php` stay quiet without a route of their own.
 */
export function loader() {
  return new Response("User-agent: *\nDisallow: /\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
