import { describe, expect, it } from "vitest";
import { getFolieDouceNonVoters, type FolieDouceGuest } from "../../src/lib/folie-douce-non-voters";

const guest = (firstName: string, lastName: string): FolieDouceGuest => ({
  firstName, lastName, displayName: [firstName, lastName].filter(Boolean).join(" "),
});

describe("getFolieDouceNonVoters", () => {
  it("returns unmatched confirmed guests in input order", () => {
    const guests = [guest("Amelia", "Drake"), guest("Kaise", ""), guest("Kristy", "Khoury"), guest("Ted", "Delcima")];
    const votes = [
      { firstName: "Kaise", lastName: "" },
      { firstName: "kristy", lastName: "khoury" },
      { firstName: "Nobody", lastName: "Here" },
    ];
    expect(getFolieDouceNonVoters(guests, votes)).toEqual([guests[0], guests[3]]);
  });

  it("does not mark either guest for an ambiguous vote", () => {
    const guests = [guest("Alex", "Smith"), guest("Alex", "Jones")];
    expect(getFolieDouceNonVoters(guests, [{ firstName: "Alex", lastName: "" }])).toEqual(guests);
  });
});
