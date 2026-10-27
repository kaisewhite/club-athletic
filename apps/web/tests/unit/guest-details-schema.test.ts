import { describe, expect, it } from "vitest";
import { guestDetailsSchema, guestDetailsSubmissionSchema } from "../../src/lib/guest-details-schema";

const valid = {
  firstName: " Alex ", lastName: "Guest", phone: "(415) 555-0132", venmoHandle: "@alex-guest",
  instagramHandle: "@alex.guest", dietaryNotes: "None.", favoriteCocktails: "Margarita, Negroni",
};

describe("guest details validation", () => {
  it("trims text, normalizes phone numbers and Instagram profiles, and maps None to null", () => {
    expect(guestDetailsSchema.parse(valid)).toEqual({
      firstName: "Alex", lastName: "Guest", phone: "+14155550132", venmoHandle: "@alex-guest",
      instagramHandle: "@alex.guest", dietaryNotes: null, favoriteCocktails: "Margarita, Negroni",
    });
  });

  it("accepts an international phone with a country code and an Instagram profile link", () => {
    expect(guestDetailsSchema.parse({ ...valid, phone: "+33 6 12 34 56 78", instagramHandle: "https://instagram.com/alex.guest/" }))
      .toMatchObject({ phone: "+33612345678", instagramHandle: "https://instagram.com/alex.guest/" });
  });

  it.each([
    [{ ...valid, firstName: "  " }, "First name is required."],
    [{ ...valid, phone: "123" }, "Enter a valid phone number, including the country code if needed."],
    [{ ...valid, venmoHandle: "alex guest" }, "Enter your Venmo handle without spaces."],
    [{ ...valid, instagramHandle: "https://example.com/alex" }, "Enter an Instagram handle or profile link."],
    [{ ...valid, dietaryNotes: "x".repeat(501) }, "Dietary restrictions must be 500 characters or fewer."],
    [{ ...valid, favoriteCocktails: "" }, "Favorite cocktails is required."],
    [{ ...valid, favoriteCocktails: "x".repeat(301) }, "Favorite cocktails must be 300 characters or fewer."],
  ])("rejects invalid input with a useful message", (value, message) => {
    const result = guestDetailsSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toContain(message);
  });

  it("requires an idempotency key and rejects unrecognized fields", () => {
    expect(guestDetailsSubmissionSchema.safeParse({ ...valid, submissionId: "not-a-uuid" }).success).toBe(false);
    expect(guestDetailsSchema.safeParse({ ...valid, extra: "unexpected" }).success).toBe(false);
  });
});
