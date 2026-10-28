import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FavoriteCocktailsCell } from "../../app/components/cocktails-cell";

let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter>;
let container: HTMLDivElement;
let savedCocktails = "Mezcal Negroni";
const submissions: unknown[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  savedCocktails = "Mezcal Negroni";
  submissions.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  router = createMemoryRouter([
    { path: "/chef", loader: () => ({ favoriteCocktails: savedCocktails }), element: <CocktailRoute /> },
    { path: "/api/guests/cocktails", action: async ({ request }) => {
      const payload = await request.json() as { guestId: string; favoriteCocktails: string | null };
      submissions.push(payload); savedCocktails = payload.favoriteCocktails ?? "";
      return Response.json({ ok: true, favoriteCocktails: payload.favoriteCocktails });
    } },
  ], { initialEntries: ["/chef"] });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  router.dispose();
  container.remove();
});

describe("FavoriteCocktailsCell", () => {
  it("edits and saves a guest's cocktail preference", async () => {
    await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Edit favorite cocktails for Valeriia Stobolva"]')!.click(); });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea.value).toBe("Mezcal Negroni");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Margarita and Negroni");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(submissions).toEqual([{ guestId: "guest-val", favoriteCocktails: "Margarita and Negroni" }]);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit favorite cocktails for Valeriia Stobolva"]')?.textContent).toContain("Margarita and Negroni");
  });
});

function CocktailRoute() {
  const data = useLoaderData() as { favoriteCocktails: string };
  return <FavoriteCocktailsCell guestId="guest-val" guestName="Valeriia Stobolva" favoriteCocktails={data.favoriteCocktails} />;
}
