import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestInstagramAvatar } from "../../app/components/guest-instagram-preview";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("GuestInstagramAvatar", () => {
  it("falls back to the dynamic avatar route before showing initials", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<GuestInstagramAvatar profileUrl="https://www.instagram.com/ari" displayName="Ari Stobaugh" />));

    const image = container.querySelector("img");
    const fallback = container.querySelector<HTMLSpanElement>(".guest-avatar-placeholder");
    expect(image?.getAttribute("src")).toBe("/guest-avatars/ari.jpg");
    expect(fallback?.textContent).toBe("AS");
    expect(fallback?.hasAttribute("hidden")).toBe(true);

    await act(async () => image?.dispatchEvent(new Event("error")));

    expect(image?.getAttribute("src")).toBe("/api/guest-avatars/ari");
    expect(image?.hidden).toBe(false);
    expect(fallback?.hidden).toBe(true);

    await act(async () => image?.dispatchEvent(new Event("error")));

    expect(image?.hidden).toBe(true);
    expect(fallback?.hidden).toBe(false);
  });
});
