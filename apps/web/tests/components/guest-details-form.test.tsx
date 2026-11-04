import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestDetailsForm } from "../../app/components/guest-details-form";

const { revalidate } = vi.hoisted(() => ({ revalidate: vi.fn() }));
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), useRevalidator: () => ({ revalidate }) }));

const rooms = [
  { id: "room-1", name: "Room One", shortName: "Room 1", type: "QUAD_BUNK", floorName: "Middle floor", openCount: 2, occupants: [{ displayName: "Alex Guest", instagramUrl: "https://www.instagram.com/alexguest/" }, { displayName: "Sam Guest", instagramUrl: null }], priceLabel: "€1,700", description: "Two single beds" },
  { id: "room-2", name: "Room Two", shortName: "Room 2", type: "BUNK_CABIN", floorName: "Top floor", openCount: 1, occupants: [], priceLabel: null, description: null },
  { id: "room-full", name: "Full Room", shortName: "Full", type: "DOUBLE", floorName: "Lower floor", openCount: 0, occupants: [{ displayName: "Jamie Guest", instagramUrl: null }], priceLabel: null, description: null },
];

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
  revalidate.mockClear();
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
  it("lists open rooms with readable types, open-spot counts and bulleted occupant Instagram links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
    await act(async () => root!.render(<GuestDetailsForm rooms={rooms} />));
    await clickButton("Start");
    await enter("guest-firstName", "Alex");
    await enter("guest-lastName", "Guest");
    await clickButton("Continue");
    const step = container.querySelector(".guest-room-options")!;
    expect(step.textContent).toContain("Quad bunk room");
    expect(step.textContent).toContain("Bunk cabin");
    expect(step.textContent).not.toMatch(/_/);
    expect(step.textContent).toContain("2 open spots");
    expect(step.textContent).toContain("1 open spot");
    expect(step.textContent).not.toContain("1 open spots");
    expect(step.textContent).not.toContain("Full Room");
    const options = step.querySelectorAll(".guest-room-option");
    const bullets = options[0]!.querySelectorAll(".guest-room-occupants li");
    expect([...bullets].map((item) => item.textContent)).toEqual(["Alex Guest", "Sam Guest"]);
    const link = bullets[0]!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://www.instagram.com/alexguest/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(options[1]!.querySelector(".guest-room-occupants")?.textContent).toContain("No one yet");
    expect(container.querySelectorAll("#guest-question-title")).toHaveLength(1);
  });

  it("does not select a room when an occupant's Instagram link is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
    await act(async () => root!.render(<GuestDetailsForm rooms={rooms} />));
    await clickButton("Start"); await enter("guest-firstName", "Alex"); await enter("guest-lastName", "Guest"); await clickButton("Continue");
    const link = container.querySelector<HTMLAnchorElement>(".guest-room-occupants a")!;
    link.addEventListener("click", (event) => event.preventDefault());
    await act(async () => { link.click(); });
    expect(container.querySelector<HTMLInputElement>('input[name="roomId"][value="room-1"]')!.checked).toBe(false);
  });

  it("starts with room selection, validates each question, and submits all guest details", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ ok: true, created: false }) }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root!.render(<GuestDetailsForm rooms={rooms} />));

    expect(container.textContent).toContain("Méribel 2027 — Guest Details");
    expect(container.textContent).toContain("Takes about a minute.");
    await clickButton("Start");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Your name");
    expect(container.querySelector(".guest-details-progress-label")?.textContent).toBe("Question 1 of 6");
    await clickButton("Continue");
    expect(container.textContent).toContain("First name is required.");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Your name");

    await enter("guest-firstName", "Alex");
    await enter("guest-lastName", "Guest");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    expect(fetch.mock.calls.some(([, init]) => JSON.parse(String(init?.body)).kind === "field" && JSON.parse(String(init?.body)).field === "firstName")).toBe(true);
    await clickButton("Continue");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Select a room");
    const firstRoomChoice = container.querySelector<HTMLInputElement>('input[name="roomId"][value="room-1"]')!;
    await act(async () => { firstRoomChoice.click(); });
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
    expect(fetch).toHaveBeenCalled();
    const [, request] = fetch.mock.calls.at(-1)!;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      firstName: "Alex", lastName: "Guest", phone: "+1 415 555 0132", venmoHandle: "@alex-guest",
      instagramHandle: "@alex.guest", dietaryNotes: "None", favoriteCocktails: "Margarita and Negroni",
      roomId: "room-1",
    });
    expect(body.submissionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("lets guests go back without clearing answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
    await act(async () => root!.render(<GuestDetailsForm rooms={rooms} />));
    await clickButton("Start");
    await enter("guest-firstName", "Alex");
    await enter("guest-lastName", "Guest");
    await clickButton("Continue");
    await act(async () => container.querySelector<HTMLInputElement>('input[name="roomId"][value="room-1"]')!.click());
    await clickButton("Continue");
    await clickButton("Back");
    await clickButton("Back");
    expect(container.querySelector<HTMLInputElement>("#guest-firstName")?.value).toBe("Alex");
    expect(container.querySelector<HTMLInputElement>("#guest-lastName")?.value).toBe("Guest");
  });

  it("returns to step 1 and refreshes the room list after a 409", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { const payload = JSON.parse(String(init.body)); return payload.kind === "field" ? { ok: true, status: 200, json: async () => ({ ok: true }) } : { ok: false, status: 409, json: async () => ({ ok: false, code: "ROOM_FULL", error: "That room no longer has an open spot. Choose another room." }) }; });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root!.render(<GuestDetailsForm rooms={rooms} />));
    await clickButton("Start");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Your name");
    await enter("guest-firstName", "Alex"); await enter("guest-lastName", "Guest"); await clickButton("Continue");
    await act(async () => container.querySelector<HTMLInputElement>('input[name="roomId"][value="room-1"]')!.click()); await clickButton("Continue");
    await enter("guest-phone", "+1 415 555 0132"); await clickButton("Continue");
    await enter("guest-venmoHandle", "@alex-guest"); await enter("guest-instagramHandle", "@alex.guest"); await clickButton("Continue");
    await enter("guest-dietaryNotes", "None"); await clickButton("Continue");
    await enter("guest-favoriteCocktails", "Margarita"); await clickButton("Continue");
    await clickButton("Continue"); await clickButton("Finish");
    expect(container.querySelector("#guest-question-title")?.textContent).toBe("Select a room");
    expect(container.querySelector(".guest-details-progress-label")?.textContent).toBe("Question 2 of 6");
    expect(container.textContent).toContain("That room no longer has an open spot. Choose another room.");
    expect(container.textContent).toContain("Room Two");
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it("does not show success for an unreadable response and retries with the same submission id", async () => {
    let finalAttempts = 0;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      if (payload.kind === "field") return { ok: true, json: async () => ({ ok: true }) };
      finalAttempts++;
      return finalAttempts === 1 ? { ok: true, json: async () => { throw new Error("Invalid JSON"); } } : { ok: true, json: async () => ({ ok: true, created: true }) };
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root!.render(<GuestDetailsForm rooms={rooms} />));
    await clickButton("Start");
    await enter("guest-firstName", "Alex"); await enter("guest-lastName", "Guest"); await clickButton("Continue");
    await act(async () => container.querySelector<HTMLInputElement>('input[name="roomId"][value="room-1"]')!.click());
    await clickButton("Continue");
    await enter("guest-phone", "+1 415 555 0132"); await clickButton("Continue");
    await enter("guest-venmoHandle", "@alex-guest"); await enter("guest-instagramHandle", "@alex.guest"); await clickButton("Continue");
    await enter("guest-dietaryNotes", "None"); await clickButton("Continue");
    await enter("guest-favoriteCocktails", "Margarita"); await clickButton("Continue");
    await clickButton("Continue");

    await clickButton("Finish");
    expect(container.textContent).toContain("The server could not confirm your submission.");
    expect(container.textContent).not.toContain("Thanks — you’re all set.");
    await clickButton("Finish");
    expect(container.textContent).toContain("Thanks — you’re all set.");
    const finalCalls = fetch.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).kind !== "field");
    expect(finalCalls).toHaveLength(2);
    const firstBody = JSON.parse(String(finalCalls[0]![1]?.body));
    const retryBody = JSON.parse(String(finalCalls[1]![1]?.body));
    expect(retryBody.submissionId).toBe(firstBody.submissionId);
    expect(retryBody.firstName).toBe("Alex");
  });
});
