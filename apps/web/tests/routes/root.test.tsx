import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { expect, it, vi } from "vitest";

import { Layout } from "../../app/root";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, Meta: () => null, Links: () => null };
});

it("marks this English-only trip site as not translatable by browser extensions", () => {
  const Stub = createRoutesStub([{ path: "/", Component: () => <Layout><main>Trip</main></Layout> }]);
  const html = renderToStaticMarkup(<Stub initialEntries={["/"]} />);
  expect(html.match(/<html[^>]*>/)?.[0]).toContain('translate="no"');
});
