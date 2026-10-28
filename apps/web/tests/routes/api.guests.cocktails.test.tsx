import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateGuestFavoriteCocktails, GuestNotFoundError } = vi.hoisted(() => {
  class GuestNotFoundError extends Error {}
  return { updateGuestFavoriteCocktails: vi.fn(), GuestNotFoundError };
});
vi.mock("../../src/lib/db/guest-writes.server", () => ({ updateGuestFavoriteCocktails, GuestNotFoundError }));
import { action, loader } from "../../app/routes/api.guests.cocktails";

beforeEach(() => {
  updateGuestFavoriteCocktails.mockReset();
  updateGuestFavoriteCocktails.mockResolvedValue("Margarita");
});
afterEach(() => vi.restoreAllMocks());

describe("guest cocktail preferences API", () => {
  it("saves a validated preference", async () => {
    const request = new Request("https://trip.example/api/guests/cocktails", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestId: "guest-1", favoriteCocktails: " Margarita " }),
    });
    const response = await action({ request });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, favoriteCocktails: "Margarita" });
    expect(updateGuestFavoriteCocktails).toHaveBeenCalledWith({ guestId: "guest-1", favoriteCocktails: "Margarita" });
  });

  it("clears an empty preference and rejects oversized values", async () => {
    const empty = await action({ request: new Request("https://trip.example/api/guests/cocktails", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestId: "guest-1", favoriteCocktails: "  " }),
    }) });
    expect(empty.status).toBe(200);
    expect(updateGuestFavoriteCocktails).toHaveBeenCalledWith({ guestId: "guest-1", favoriteCocktails: null });

    const oversized = await action({ request: new Request("https://trip.example/api/guests/cocktails", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestId: "guest-1", favoriteCocktails: "x".repeat(301) }),
    }) });
    expect(oversized.status).toBe(400);
    expect(updateGuestFavoriteCocktails).toHaveBeenCalledTimes(1);
    expect((await loader()).status).toBe(405);
  });

  it("returns 404 when the guest does not exist", async () => {
    updateGuestFavoriteCocktails.mockRejectedValue(new GuestNotFoundError());
    const response = await action({ request: new Request("https://trip.example/api/guests/cocktails", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestId: "missing", favoriteCocktails: "Martini" }),
    }) });
    expect(response.status).toBe(404);
  });
});
