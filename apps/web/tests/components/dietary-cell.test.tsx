import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DietaryCell, DietaryCopyButton, DietaryGuestAdd } from "../../app/components/dietary-cell";
import { FavoriteCocktailsCell } from "../../app/components/cocktails-cell";

let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter>;
let container: HTMLDivElement;
const submitted: unknown[] = [];
let savedNotes = "No nuts";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  submitted.length = 0;
  savedNotes = "No nuts";
  container = document.createElement("div"); document.body.append(container);
  router = createMemoryRouter([
    { path: "/chef", loader: () => ({ dietaryNotes: savedNotes }), element: <DietaryRoute /> },
    { path: "/api/guests/dietary", action: async ({ request }) => { const payload = await request.json(); submitted.push(payload); savedNotes = payload.dietaryNotes; return Response.json({ ok: true, dietaryNotes: savedNotes }); } },
  ], { initialEntries: ["/chef"] });
});

afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; router.dispose(); container.remove(); vi.unstubAllGlobals();
});

describe("DietaryCell", () => {
  it("aligns the add-yourself icon with its label", async () => {
    await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
    const icon = container.querySelector<HTMLElement>(".dietary-add-icon")!;
    expect(icon).not.toBeNull();
    expect(icon.parentElement?.className).toBe("dietary-add-button");
    expect(icon.parentElement?.textContent).toContain("Add yourself");
  });

  it("expands an existing multiline note as soon as editing opens", async () => {
    savedNotes = "No nuts.\nNo sesame.\nUse separate utensils.";

    // happy-dom has no layout engine; supply the browser's measured content height.
    const height = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(96);

    try {
      await act(async () => { await router.revalidate(); });
      await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Edit dietary needs for Ada Lovelace"]')!.click(); });

      const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;

      expect(textarea.value).toBe(savedNotes);
      expect(Number.parseFloat(textarea.style.height)).toBeGreaterThanOrEqual(96);
      expect(submitted).toEqual([]);
    } finally {
      height.mockRestore();
    }
  });

  it("opens on click and submits the edited text with Enter", async () => {
    await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Edit dietary needs for Ada Lovelace"]')!.click(); });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea).not.toBeNull(); expect(textarea.value).toBe("No nuts");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Updated note"); textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(submitted).toEqual([{ guestId: "guest-1", dietaryNotes: "Updated note" }]);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit dietary needs for Ada Lovelace"]')?.textContent).toContain("Updated note");
    await act(async () => { await router.revalidate(); });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit dietary needs for Ada Lovelace"]')?.textContent).toContain("Updated note");
  });

  it("copies dietary needs and favorite drinks in a plain-text list", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Copy guest food preferences"]')!.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("Ada Lovelace\nDietary needs:\n• No nuts\nFavorite drinks:\n• Dirty martini\n• Mojito\n\nGrace Hopper\nDietary needs:\n—\nFavorite drinks:\n—");
    expect(container.querySelector<HTMLButtonElement>(".dietary-copy-button")?.getAttribute("aria-label")).toBe("Guest food preferences copied");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Guest food preferences copied to clipboard.");
  });

  it("renders each dietary and drink preference as a separate list item", async () => {
    savedNotes = "• Gluten (European wheat may be okay) • Dairy";
    await act(async () => { await router.revalidate(); });
    await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });

    const lists = container.querySelectorAll(".dietary-preference-list");
    expect(lists).toHaveLength(2);
    expect([...lists[0].querySelectorAll(".dietary-preference-item > span:last-child")].map((item) => item.textContent)).toEqual([
      "Gluten (European wheat may be okay)",
      "Dairy",
    ]);
    expect([...lists[1].querySelectorAll(".dietary-preference-item > span:last-child")].map((item) => item.textContent)).toEqual([
      "Dirty martini",
      "Mojito",
    ]);
  });
});

function DietaryRoute() {
  const data = useLoaderData() as { dietaryNotes: string };
  return <><DietaryGuestAdd /><DietaryCopyButton guests={[
    { displayName: "Ada Lovelace", dietaryNotes: data.dietaryNotes, favoriteCocktails: "• Dirty martini\n• Mojito" },
    { displayName: "Grace Hopper", dietaryNotes: null, favoriteCocktails: null },
  ]} /><table><tbody><tr><td><DietaryCell guestId="guest-1" guestName="Ada Lovelace" dietaryNotes={data.dietaryNotes} /></td><td><FavoriteCocktailsCell guestId="guest-1" guestName="Ada Lovelace" favoriteCocktails={"• Dirty martini\n• Mojito"} /></td></tr></tbody></table></>;
}
