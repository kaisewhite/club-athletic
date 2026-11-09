import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterContextProvider, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Overview, { loader } from "../../app/routes/overview";
import Chat from "../../app/routes/chat";
import { AppShell } from "../../app/components/app-shell";
import type { ConversationDetails } from "@/lib/chat/contracts";

const mocks = vi.hoisted(() => ({ trip: vi.fn(), schedule: vi.fn(), subscribe: vi.fn(), start: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/db/repository.server", () => ({ getTripOverview: mocks.trip, getSchedule: mocks.schedule }));
vi.mock("../../app/lib/chat/api", async original => ({ ...await original<object>(), subscribeToConversationStream: mocks.subscribe, startConversation: mocks.start, fetchConversationDetails: mocks.detail }));
const conversation: ConversationDetails = { id: "selected-conversation", tripId: "trip", status: "completed", createdAt: "", finishedAt: null, error: null, events: [{ id: "user", seq: 0, type: "user_message", payload: { text: "Stored question", delivery: "sent" } }, { id: "answer", seq: 1, type: "message", payload: { text: "Arrive by 08:30.\nSource: flights" } }], eventsTruncated: false, eventsCursor: null, lastEventSeq: 1, agentSessionId: null, pendingWakeupAt: null, chat: { canSend: true, activeTurn: false, runtimeStatus: "waiting", reason: null, waitingOnApproval: false, pendingWakeupAt: null } };
let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let container: HTMLDivElement;
let cleanup: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mocks.trip.mockResolvedValue({ destination: "Méribel, France", resort: "Les 3 Vallées", startDate: new Date("2027-01-30Z"), endDate: new Date("2027-02-06Z"), timezone: "Europe/Paris", currency: "EUR", pricing: { minPerPerson: 1620.15, maxPerPerson: 1790.15 }, openCount: 10, guestCount: 9, capacity: 20, chefBreakfastCount: 6, chefDinnerCount: 5, flightArrivalCutoff: "08:30", flightReturnCutoff: "11:00", property: { name: "Falcon", address: "269 Test, France", mapsUrl: "https://maps.google.com", description: "~200 m from slopes" }, shuttles: [] });
  mocks.schedule.mockResolvedValue([]);
  mocks.detail.mockReset().mockResolvedValue(conversation);
  cleanup = vi.fn(); mocks.subscribe.mockReset().mockReturnValue(Object.assign(cleanup, { finished: Promise.resolve() }));
  mocks.start.mockReset(); container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; router?.dispose(); router = undefined;
  document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function request(cookie = document.cookie) {
  // happy-dom applies browser forbidden-header filtering in Request's ctor;
  // model the server adapter's received Cookie header after construction.
  const req = new Request("https://trip.test/"); req.headers.set("Cookie", cookie);
  // `future.v8_middleware` types loader `context` as a RouterContextProvider, not `{}`.
  // Overview's loader never reads it; this is a type-correct empty provider.
  return { request: req, params: {}, context: new RouterContextProvider(), url: new URL(req.url), pattern: "/" as const };
}
async function mount(path = "/chat") {
  function Page() { const data = useLoaderData<typeof loader>(); return <Overview loaderData={data} params={{}} matches={[] as never} />; }
  router = createMemoryRouter([{ element: <AppShell daysUntil={100} />, children: [
    { path: "/", loader: () => loader(request()), element: <Page />, hydrateFallbackElement: <div>Loading</div> },
    { path: "/chat", element: <Chat /> },
    { path: "/flights", element: <div>Flight page</div> },
  ] }], { initialEntries: [path] });
  await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router!} />); });
}

it("does not restore a prior visitor's conversation from a browser-wide cookie", async () => {
  const data = await loader(request(`club-athletic-conversation=${conversation.id}`));
  expect(data.week).toBeDefined(); expect(mocks.detail).not.toHaveBeenCalled();
});
it("clears the legacy conversation cookie when a fresh app session mounts", async () => {
  document.cookie = `club-athletic-conversation=${conversation.id}; Path=/; Max-Age=2592000`;
  await mount();
  expect(document.cookie).not.toContain("club-athletic-conversation=");
});
it("shows TBD for open ticker days and keeps scheduled event titles", async () => {
  mocks.schedule.mockResolvedValue([
    { id: "planned", dow: "Sun", dayNumber: 31, eventTitle: "Dinner at the chalet", isOpen: false },
    { id: "tuesday", dow: "Tue", dayNumber: 2, eventTitle: "TBD", isOpen: true },
    { id: "friday", dow: "Fri", dayNumber: 5, eventTitle: "Open — last ski day", isOpen: true },
  ]);

  const data = await loader(request());

  expect(data.week.map(({ event }) => event)).toEqual(["Dinner at the chalet", "TBD", "TBD"]);
});
it("keeps the active conversation only in this app session across SPA navigation", async () => {
  mocks.start.mockResolvedValue({ ok: true, conversationId: conversation.id, seq: 0 }); await mount();
  await act(async () => container.querySelector<HTMLButtonElement>(".suggestions button")!.click());
  expect(container.textContent).toContain("What time do I need to land?");
  await act(async () => { await router!.navigate("/flights"); });
  expect(router!.state.location.pathname).toBe("/flights");
  await act(async () => { await router!.navigate("/chat"); });
  expect(mocks.detail).toHaveBeenCalledWith(conversation.id, expect.any(AbortSignal));
  expect(container.textContent).toContain("Stored question");
});
it("the top bar New chat detaches from any section and next ask creates a fresh conversation", async () => {
  mocks.start.mockResolvedValue({ ok: true, conversationId: conversation.id, seq: 0 }); await mount();
  await act(async () => container.querySelector<HTMLButtonElement>(".suggestions button")!.click());
  await act(async () => { await router!.navigate("/flights"); });
  await act(async () => { await router!.navigate("/chat"); });
  expect(container.textContent).toContain("Stored question");
  // On /chat the top bar's action is New chat; it drops the selection.
  await act(async () => container.querySelector<HTMLButtonElement>(".new-chat")!.click());
  expect(router!.state.location.pathname).toBe("/chat");
  expect(container.querySelectorAll(".overview-tile")).toHaveLength(0); expect(container.textContent).not.toContain("Stored question");
  mocks.start.mockRejectedValue(new Error("unavailable"));
  await act(async () => container.querySelector<HTMLButtonElement>(".suggestions button")!.click());
  expect(mocks.start).toHaveBeenCalledTimes(2); expect(conversation.events).toHaveLength(2);
});
/**
 * Every text node under `root`, in document order. `nodeType === 3` rather than
 * `Node.TEXT_NODE` so this does not lean on a happy-dom global.
 */
/**
 * The no-duplication rule, mechanically (owner, 2026-09-28: "we don't need to
 * display things redundantly"). happy-dom's default 1024px width puts
 * `useWideLayout()` in the wide branch, so the top bar and footer are the chrome under test
 * here; the narrow top bar and the CSS reveal of the date range are asserted by
 * Playwright in `tests/visual/mobile-layout.spec.ts`.
 */
it("keeps the mobile and desktop chrome free of redundant trip metadata", async () => {
  await mount("/");
  const chrome = container.querySelector(".top-nav")!;
  expect(container.querySelector(".site-footer")?.textContent).not.toMatch(/days until|2027/i);
  // Dates, countdowns, addresses, and icons belong on the relevant detail page.
  expect(container.querySelectorAll(".countdown-number")).toHaveLength(0);
  expect(container.querySelector(".hero-countdown")).toBeNull();
  expect(container.querySelector(".trip-line-place, .trip-line-dates, .mary-bell-icon")).toBeNull();
  expect(chrome.textContent).not.toMatch(/days until/i);
  const headings = [...container.querySelectorAll("h1")];
  expect(headings).toHaveLength(1);
  expect(headings[0]!.id).toBe("trip-welcome-title");
  expect(headings[0]!.textContent).toContain("Three Valleys.");
  expect(container.querySelector('.trip-chapters a[href="/faq"]')?.textContent).toContain("Trip questions");
});

it("starts a fresh chat view on a document load of /chat", async () => {
  await mount();
  const headings = [...container.querySelectorAll("h1")];
  expect(headings).toHaveLength(1);
  expect(headings[0]!.id).toBe("overview-heading");
  expect(headings[0]!.textContent).toBe("How can I help?");
});

it("shows the trip info on the home page by default, with no dialog to open", async () => {
  await mount("/");
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.querySelector(".composer")).toBeNull();
  const info = container.querySelector(".trip-welcome")!;
  expect(info.tagName).toBe("SECTION");
  expect(info.textContent).toContain("January 30–February 6, 2027");
  for (const heading of ["Included", "The chalet", "Plan your budget"]) expect(info.textContent).toContain(heading);
  expect(info.querySelector('a[href="/pricing"]')?.textContent).toContain("See rooms & prices");
  expect(info.querySelector('a[href="/chat"]')?.textContent).toBe("Ask the trip guide");
});

it("splits desktop navigation into six primary pages and a More menu, with every page in the footer", async () => {
  await mount("/");
  const bar = [...container.querySelectorAll(".top-nav .top-nav-item")].map((link) => link.textContent);
  expect(bar).toEqual(["Chalet", "Rooms", "Pricing", "Shuttle", "Flights", "Schedule"]);
  const more = [...container.querySelectorAll(".more-menu .more-menu-item")].map((link) => link.textContent);
  expect(more).toEqual(["Overview", "Chef", "Tasks", "Guests", "Guest questionnaire", "Links", "FAQ", "La Folie Douce"]);
  // Icon-only actions keep their names for assistive tech.
  expect(container.querySelector(".more-toggle")?.getAttribute("aria-label")).toBe("More pages");
  expect(container.querySelector(".top-nav-chat")?.getAttribute("aria-label")).toBe("Chat");
  const footer = [...container.querySelectorAll(".site-footer a")].map((link) => link.getAttribute("href"));
  for (const path of ["/", "/chat", "/chalet", "/rooms", "/pricing", "/shuttle", "/flights", "/schedule", "/chef", "/tasks", "/guests", "/guest-questionnaire", "/links", "/faq"]) {
    expect(footer, `footer links ${path}`).toContain(path);
  }
  expect(container.querySelector('.top-nav-chat[href="/chat"]')).not.toBeNull();
});

it("opens More with its links reachable, and closes it on Escape back to the toggle", async () => {
  await mount("/");
  const toggle = container.querySelector<HTMLButtonElement>(".more-toggle")!;
  const panel = container.querySelector<HTMLElement>("#more-pages")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel.hasAttribute("inert")).toBe(true);
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(panel.hasAttribute("inert")).toBe(false);
  expect(panel.dataset.open).toBe("true");
  expect(document.activeElement?.textContent).toBe("Overview");
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel.hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(toggle);
  expect(document.body.style.overflow).toBe("");
});

it("hides the footer on /chat so the composer stays the bottom of the page", async () => {
  await mount();
  expect(container.querySelector(".site-footer")).toBeNull();
  expect(container.querySelector(".new-chat")).not.toBeNull();
});

it("gives the mobile header the menu on the left and an icon-only Chat link on the right", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
  await mount("/");
  expect(container.querySelector(".mobile-trip-overview")).toBeNull();
  const link = container.querySelector<HTMLAnchorElement>(".mobile-chat-link");
  expect(link?.textContent).toBe("");
  expect(link?.getAttribute("aria-label")).toBe("Chat");
  expect(link?.getAttribute("href")).toBe("/chat");
  const bar = container.querySelector(".mobile-nav-bar")!;
  expect([...bar.children].map((el) => el.className)).toEqual(["mobile-nav-toggle", "mobile-brand", "mobile-chat-link"]);
});
