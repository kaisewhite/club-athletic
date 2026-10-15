import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScheduleCopyButton } from "../../app/components/schedule-copy-button";

describe("ScheduleCopyButton", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("copies the complete daily schedule and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await act(async () => {
      root = createRoot(container);
      root.render(<ScheduleCopyButton dayLabel="Mon 1 schedule" text={'Mon 1\n15:00 — Croissant, ski, repeat: La Folie Douce, 3–5 p.m.'} />);
    });
    await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("Mon 1\n15:00 — Croissant, ski, repeat: La Folie Douce, 3–5 p.m.");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Mon 1 schedule copied");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Mon 1 schedule copied to clipboard.");
  });
});
