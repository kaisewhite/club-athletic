import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyAllLinksButton } from "../../app/components/copy-all-links-button";
import { CopyAllNamesButton } from "../../app/components/copy-all-names-button";

describe("guest copy buttons", () => {
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

  it("copies confirmed guest names in spreadsheet columns and keeps the links button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await act(async () => {
      root = createRoot(container);
      root.render(<><CopyAllLinksButton links={["https://instagram.com/example"]} /><CopyAllNamesButton guests={[
        { firstName: "Kristy", lastName: "Khoury" },
        { firstName: "Ted", lastName: "Delcima" },
      ]} /></>);
    });
    expect(container.textContent).toContain("Copy links");
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === "Copy names");
    expect(button?.getAttribute("aria-label")).toBe("Copy all guest names");
    await act(async () => { button!.click(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith("Kristy\tKhoury\nTed\tDelcima");
  });
});
