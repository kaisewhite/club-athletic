import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DietaryCell, DietaryCopyButton } from "../../app/components/dietary-cell";

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
    expect(container.textContent).toContain("Updated note");
  });

  it("copies one guest per line as plain text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Copy dietary requirements"]')!.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("Ada Lovelace: No nuts\nGrace Hopper: —");
    expect(container.querySelector<HTMLButtonElement>(".dietary-copy-button")?.getAttribute("aria-label")).toBe("Dietary requirements copied");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Dietary requirements copied to clipboard.");
  });
});

function DietaryRoute() {
  const data = useLoaderData() as { dietaryNotes: string };
  return <><DietaryCopyButton guests={[
    { displayName: "Ada Lovelace", dietaryNotes: data.dietaryNotes },
    { displayName: "Grace Hopper", dietaryNotes: null },
  ]} /><table><tbody><tr><td><DietaryCell guestId="guest-1" guestName="Ada Lovelace" dietaryNotes={data.dietaryNotes} /></td></tr></tbody></table></>;
}
