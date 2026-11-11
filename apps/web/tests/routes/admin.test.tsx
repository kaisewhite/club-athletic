import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminGuests, getFolieDouceVotes } = vi.hoisted(() => ({ getAdminGuests: vi.fn(), getFolieDouceVotes: vi.fn() }));
vi.mock("@/lib/db/repository.server", () => ({ getAdminGuests, getFolieDouceVotes }));

import Admin, { headers, loader } from "../../app/routes/admin";

const guest = {
  id: "g1", firstName: "Jacqueline", lastName: "Herrera", displayName: "Jacqueline Herrera", status: "CONFIRMED",
  instagramUrl: "https://www.instagram.com/Jacquelineann_1", phone: "+1 555 555 0100", venmoHandle: "@jac-venmo",
  dietaryNotes: "No shellfish", favoriteCocktails: "Negroni",
  spot: { index: 2, room: { name: "Bedroom 8" } },
  tasks: [{ id: "task1", type: "PAYMENT", done: true, completedAt: new Date("2026-11-01T12:00:00Z"), notes: null }],
  flights: [{
    id: "f1", direction: "INBOUND", airline: "United", flightNumber: "UA956", origin: "EWR", destination: "GVA",
    scheduledDeparture: new Date("2027-01-29T22:30:00Z"), scheduledArrival: new Date("2027-01-30T06:30:00Z"),
    departureLocal: "2027-01-29T17:30:00-05:00", arrivalLocal: "2027-01-30T07:30:00+01:00", confirmationCode: "ABC123", terminal: "B",
  }],
};


function render(loaderData: Awaited<ReturnType<typeof loader>>) {
  const props = { loaderData } as unknown as Parameters<typeof Admin>[0];
  const Stub = createRoutesStub([{ path: "/admin", Component: () => <Admin {...props} /> }]);
  const html = renderToStaticMarkup(<Stub initialEntries={["/admin"]} />);
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ") };
}

beforeEach(() => {
  getAdminGuests.mockReset();
  getAdminGuests.mockResolvedValue([guest]);
  getFolieDouceVotes.mockReset();
  getFolieDouceVotes.mockResolvedValue({ vip: [], generalAdmission: [] });
});

describe("/admin", () => {
  it("is not cached by browsers or proxies", () => {
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });

  it("collapses empty fields into one Not provided line and hides a duplicate full name", async () => {
    getAdminGuests.mockResolvedValue([{ ...guest, displayName: "Jacqueline Herrera", venmoHandle: null, flights: [] }]);
    const { text } = render(await loader());
    expect(text).toContain("Not provided: Venmo");
    expect(text).not.toContain("Email");
    expect(text).toContain("No flights yet");
    expect(text.match(/Jacqueline Herrera/g)).toHaveLength(1);
  });

  it("shows everything each guest filled out", async () => {
    const data = await loader();
    expect(getAdminGuests).toHaveBeenCalledOnce();
    const { text } = render(data);
    for (const value of ["Jacqueline Herrera", "@jac-venmo", "+1 555 555 0100", "@Jacquelineann_1", "Bedroom 8 · spot 2",
      "No shellfish", "Negroni", "Payment Done Sun 1 Nov", "Arriving", "United UA956", "Departs EWR Fri 29 Jan · 17:30", "Lands GVA Sat 30 Jan · 07:30", "Confirmation ABC123 · Terminal B"]) {
      expect(text).toContain(value);
    }
    // Airport-local wall times, never UTC.
    expect(text).toMatch(/EWR\s+to\s+GVA/);
    expect(text).not.toContain("UTC");
    expect(text).not.toMatch(/[A-Z]+_[A-Z]+/);
    for (const removed of ["Emergency contact", "Notes", "Added via", "Form submissions", "Payments"]) expect(text).not.toContain(removed);
  });

  it("tracks the seven refund follow-ups on the admin page", async () => {
    const { text } = render(await loader());
    expect(text).toContain("Refunds to track");
    expect(text).toContain("People identified for refund follow-up · 7 guests");
    for (const name of ["Augustus", "Pete", "Amelia", "Kristy Khoury", "Valeria", "Ted", "Elijah"]) {
      expect(text).toContain(name);
    }
    expect(text).not.toMatch(/refund.*13 people|13 people.*refund/i);
  });
});
