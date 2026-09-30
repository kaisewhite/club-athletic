import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterContextProvider, RouterProvider, useLoaderData } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Overview, { loader } from "../../app/routes/overview";
import { AppShell } from "../../app/components/app-shell";
import { readConversationSelection, setConversationSelection } from "../../app/lib/chat/detail-loader";
import type { ConversationDetails } from "@/lib/chat/contracts";

const mocks = vi.hoisted(() => ({ trip: vi.fn(), schedule: vi.fn(), conversation: vi.fn(), subscribe: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/db/repository.server", () => ({ getTripOverview: mocks.trip, getSchedule: mocks.schedule }));
vi.mock("../../app/routes/api.chat.conversation", () => ({ loader: mocks.conversation }));
vi.mock("../../app/lib/chat/api", async original => ({ ...await original<object>(), subscribeToConversationStream: mocks.subscribe, startConversation: mocks.start }));
const conversation: ConversationDetails = { id: "selected-conversation", tripId: "trip", status: "completed", createdAt: "", finishedAt: null, error: null, events: [{ id: "user", seq: 0, type: "user_message", payload: { text: "Stored question", delivery: "sent" } }, { id: "answer", seq: 1, type: "message", payload: { text: "Arrive by 08:30.\nSource: flights" } }], eventsTruncated: false, eventsCursor: null, lastEventSeq: 1, agentSessionId: null, pendingWakeupAt: null, chat: { canSend: true, activeTurn: false, runtimeStatus: "waiting", reason: null, waitingOnApproval: false, pendingWakeupAt: null } };
let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let container: HTMLDivElement;
let cleanup: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  mocks.trip.mockResolvedValue({ destination: "Méribel, France", resort: "Les 3 Vallées", startDate: new Date("2027-01-30Z"), endDate: new Date("2027-02-06Z"), timezone: "Europe/Paris", currency: "EUR", pricing: { minPerPerson: 1690, maxPerPerson: 1860 }, openCount: 10, guestCount: 9, capacity: 20, chefBreakfastCount: 6, chefDinnerCount: 5, flightArrivalCutoff: "08:30", flightReturnCutoff: "11:00", property: { name: "Falcon", address: "269 Test, France", mapsUrl: "https://maps.google.com", description: "~200 m from slopes" }, shuttles: [] });
  mocks.schedule.mockResolvedValue([]);
  mocks.conversation.mockReset().mockImplementation(async () => Response.json(conversation));
  cleanup = vi.fn(); mocks.subscribe.mockReset().mockReturnValue(Object.assign(cleanup, { finished: Promise.resolve() }));
  mocks.start.mockReset(); container = document.createElement("div"); document.body.append(container);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined; router?.dispose(); router = undefined;
  setConversationSelection(null); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function request(cookie = document.cookie) {
  // happy-dom applies browser forbidden-header filtering in Request's ctor;
  // model the server adapter's received Cookie header after construction.
  const req = new Request("https://trip.test/"); req.headers.set("Cookie", cookie);
  // `future.v8_middleware` types loader `context` as a RouterContextProvider, not `{}`.
  // Overview's loader never reads it; this is a type-correct empty provider.
  return { request: req, params: {}, context: new RouterContextProvider(), url: new URL(req.url), pattern: "/" as const };
}
async function mount() {
  function Page() { const data = useLoaderData<typeof loader>(); return <Overview loaderData={data} params={{}} matches={[] as never} />; }
  router = createMemoryRouter([{ element: <AppShell daysUntil={100} />, children: [
    { path: "/", loader: () => loader(request()), element: <Page />, hydrateFallbackElement: <div>Loading</div> },
    { path: "/flights", element: <div>Flight page</div> },
  ] }]);
  await act(async () => { root = createRoot(container); root.render(<RouterProvider router={router!} />); });
}

it("loads initial selected detail through Task 2's redacted resource loader", async () => {
  setConversationSelection(conversation.id);
  const data = await loader(request());
  expect(mocks.conversation.mock.calls[0]![0].params).toEqual({ conversationId: conversation.id });
  expect(data.chat.conversation).toEqual(conversation); expect(data.week).toBeDefined();
});
it("does not read any chat when there is no valid selection", async () => {
  const data = await loader(request("club-athletic-conversation=../invalid"));
  expect(data.selectedId).toBeNull(); expect(data.chat.conversation).toBeNull(); expect(mocks.conversation).not.toHaveBeenCalled();
});
it("exposes only safe chat error copy when selected detail fails", async () => {
  setConversationSelection(conversation.id); mocks.conversation.mockRejectedValue(new Error("PrismaClient secret booking PNR"));
  const data = await loader(request());
  expect(data.chat.error).toBe("The conversation couldn’t be loaded. Please try again.");
  expect(JSON.stringify(data)).not.toMatch(/PrismaClient|PNR|secret/);
});
it("hydrates the thread instead of tiles, navigates source routes, and restores selection on returning Home", async () => {
  setConversationSelection(conversation.id); await mount();
  // The thread replaces the home content entirely — no tile grid and no chip row
  // above it (owner, 2026-09-28: the conversation "should take up everything on
  // that screen. There should not be an additional header").
  expect(container.querySelector(".overview-tiles")).toBeNull(); expect(container.querySelectorAll(".chat-tile-chips a")).toHaveLength(0);
  expect(container.textContent).toContain("Stored question");
  await act(async () => container.querySelector<HTMLAnchorElement>('.chat-sources a[href="/flights"]')!.click());
  expect(router!.state.location.pathname).toBe("/flights"); expect(cleanup).toHaveBeenCalled();
  expect(readConversationSelection(document.cookie)).toBe(conversation.id);
  await act(async () => { await router!.navigate("/"); });
  expect(container.textContent).toContain("Stored question"); expect(mocks.conversation).toHaveBeenCalledTimes(2);
});
it("sidebar New question detaches from any section and next ask creates a fresh conversation", async () => {
  setConversationSelection(conversation.id); await mount();
  await act(async () => { await router!.navigate("/flights"); });
  await act(async () => container.querySelector<HTMLButtonElement>(".new-chat")!.click());
  expect(router!.state.location.pathname).toBe("/"); expect(readConversationSelection(document.cookie)).toBeNull();
  expect(container.querySelectorAll(".overview-tile")).toHaveLength(0); expect(container.textContent).not.toContain("Stored question");
  expect(container.querySelector('.home-welcome a[href="/faq"]')?.textContent).toContain("Browse frequently asked questions");
  mocks.start.mockRejectedValue(new Error("unavailable"));
  await act(async () => container.querySelector<HTMLButtonElement>(".suggestions button")!.click());
  expect(mocks.start).toHaveBeenCalledTimes(1); expect(conversation.events).toHaveLength(2);
});
/**
 * Every text node under `root`, in document order. `nodeType === 3` rather than
 * `Node.TEXT_NODE` so this does not lean on a happy-dom global.
 */
/**
 * The no-duplication rule, mechanically (owner, 2026-09-28: "we don't need to
 * display things redundantly"). happy-dom's default 1024px width puts
 * `useWideLayout()` in the wide branch, so the sidebar is the chrome under test
 * here; the narrow top bar and the CSS reveal of the date range are asserted by
 * Playwright in `tests/visual/mobile-layout.spec.ts`.
 */
it("keeps the mobile and desktop chrome free of redundant trip metadata", async () => {
  await mount();
  const chrome = container.querySelector(".sidebar")!;
  // Dates, countdowns, addresses, and icons belong on the relevant detail page.
  expect(container.querySelectorAll(".countdown-number")).toHaveLength(0);
  expect(container.querySelector(".hero-countdown")).toBeNull();
  expect(container.querySelector(".trip-line-place, .trip-line-dates, .mary-bell-icon")).toBeNull();
  expect(chrome.textContent).not.toMatch(/days until/i);
  const headings = [...container.querySelectorAll("h1")];
  expect(headings).toHaveLength(1);
  expect(headings[0]!.id).toBe("overview-heading");
  expect(headings[0]!.textContent).toBe("How can I help with the trip?");
  expect(container.querySelector('.home-welcome a[href="/faq"]')).not.toBeNull();
});

it("clears an initial detail-load error after framework revalidation succeeds", async () => {
  setConversationSelection(conversation.id); mocks.conversation.mockResolvedValueOnce(Response.json({ error: "private failure" }, { status: 503 })); await mount();
  expect(container.textContent).toContain("couldn’t be loaded");
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Try again")!.click());
  expect(container.textContent).toContain("Stored question"); expect(container.textContent).not.toContain("couldn’t be loaded");
});
