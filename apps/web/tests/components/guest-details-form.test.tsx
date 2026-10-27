import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestDetailsForm } from "../../app/components/guest-details-form";

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove();
  root = undefined;
  vi.unstubAllGlobals();
});

async function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function enter(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  expect(input).toBeDefined();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("GuestDetailsForm", () => {
  it("matches the complete Typeform flow, validates each question, and submits all guest details", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ ok: true, created: false }) }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root!.render(<GuestDetailsForm />));

    expect(container.textContent).toContain("Méribel 2027 — Guest Details");
    expect(container.textContent).toContain("Takes about a minute.");
    await clickButton("Start");
    await clickButton("Continue");
    expect(container.textContent).toContain("First name is required.");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Your name");

    await enter("guest-firstName", "Alex");
    await enter("guest-lastName", "Guest");
    await clickButton("Continue");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Mobile / WhatsApp number");
    await enter("guest-phone", "123");
    await clickButton("Continue");
    expect(container.textContent).toContain("Enter a valid phone number");
    await enter("guest-phone", "+1 415 555 0132");
    await clickButton("Continue");

    await enter("guest-venmoHandle", "@alex-guest");
    await enter("guest-instagramHandle", "@alex.guest");
    await clickButton("Continue");
    await enter("guest-dietaryNotes", "None");
    await clickButton("Continue");
    await enter("guest-favoriteCocktails", "Margarita and Negroni");
    await clickButton("Continue");

    expect(container.textContent).toContain("Payment & cancellation policy");
    expect(container.textContent).toContain("there is no deposit");
    await clickButton("Continue");
    expect(container.textContent).toContain("Trip details & group chat");
    expect(container.querySelector('a[href="https://meribel.clubathletic.org/"]')).toBeDefined();
    expect(container.querySelector('a[href^="https://chat.whatsapp.com/"]')).toBeDefined();
    await clickButton("Finish");

    expect(container.textContent).toContain("Thanks — you’re all set.");
    expect(container.textContent).toContain("Your guest details have been submitted.");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, request] = fetch.mock.calls[0]!;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      firstName: "Alex", lastName: "Guest", phone: "+1 415 555 0132", venmoHandle: "@alex-guest",
      instagramHandle: "@alex.guest", dietaryNotes: "None", favoriteCocktails: "Margarita and Negroni",
    });
    expect(body.submissionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("lets guests go back without clearing answers", async () => {
    await act(async () => root!.render(<GuestDetailsForm />));
    await clickButton("Start");
    await enter("guest-firstName", "Alex");
    await enter("guest-lastName", "Guest");
    await clickButton("Continue");
    await clickButton("Back");
    expect(container.querySelector<HTMLInputElement>("#guest-firstName")?.value).toBe("Alex");
    expect(container.querySelector<HTMLInputElement>("#guest-lastName")?.value).toBe("Guest");
  });
});
