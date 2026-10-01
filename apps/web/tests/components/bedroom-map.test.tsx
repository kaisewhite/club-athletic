import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BedroomMap } from "../../app/components/bedroom-map/bedroom-map";

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("opens the authored map at full size and closes it without changing the inline map", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const floors = [{ id: "floor", name: "Lower floor", code: "R9", rooms: [{ id: "room", name: "Bedroom 6", description: null }] }];
  try {
    await act(async () => root.render(<BedroomMap floors={floors} />));
    expect(container.querySelectorAll(".bm-sheet")).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>(".bm-expand")!.click());
    const dialog = container.querySelector<HTMLDialogElement>(".bm-dialog");
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector(".bm-expanded-canvas .bm-room-marker")?.textContent).toBe("Bedroom 6");
    expect(container.querySelectorAll(".bm-sheet")).toHaveLength(2);
    await act(async () => container.querySelector<HTMLButtonElement>(".bm-dialog-bar button")!.click());
    expect(container.querySelector(".bm-dialog")).toBeNull();
    expect(container.querySelectorAll(".bm-sheet")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
  }
});
