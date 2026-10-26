import { describe, expect, it } from "vitest";
import { InvalidTypeformResponseError, parseTypeformGuestUpdate } from "../../src/lib/typeform/guest-response.server";

const fieldIds = {
  first_name: ["DShYC3NuIr95", "short_text"],
  last_name: ["bIn6j2D7WewD", "short_text"],
  venmo_handle: ["SXtc36v2nIhc", "short_text"],
  instagram_handle: ["YUkKknnPoSgl", "short_text"],
  mobile_number: ["gOk3Edpu3bwj", "phone_number"],
  dietary_restrictions: ["N5JnH5AJOERl", "long_text"],
  favorite_cocktails: ["m37BQpxVwI6N", "long_text"],
} as const;

function response(values: Partial<Record<keyof typeof fieldIds, string>>) {
  const answers = Object.entries(values).map(([ref, value]) => {
    const [id, fieldType] = fieldIds[ref as keyof typeof fieldIds];
    return ref === "mobile_number"
      ? { type: "phone_number", phone_number: value, field: { id, ref, type: fieldType } }
      : { type: "text", text: value, field: { id, ref, type: fieldType } };
  });
  return { event_type: "form_response", form_response: {
    form_id: "s7gvWdIF", token: "response-123", submitted_at: "2026-10-27T12:30:00Z", answers,
  } };
}

describe("Typeform guest response mapping", () => {
  it("maps by the form's field refs, normalizes Instagram, and treats None as clearing dietary notes", () => {
    expect(parseTypeformGuestUpdate(response({
      first_name: "Amelia", last_name: "Drake", venmo_handle: "@amelia", instagram_handle: "@amelia_d",
      mobile_number: "+1 555 0100", dietary_restrictions: "None.", favorite_cocktails: "Negroni, spritz",
    }))).toEqual({
      responseId: "response-123", formId: "s7gvWdIF", submittedAt: new Date("2026-10-27T12:30:00Z"),
      firstName: "Amelia", lastName: "Drake", venmoHandle: "@amelia", phone: "+1 555 0100",
      dietaryNotes: null, instagramUrl: "https://www.instagram.com/amelia_d", favoriteCocktails: "Negroni, spritz",
    });
  });

  it("leaves unanswered optional fields undefined so existing values are preserved", () => {
    const update = parseTypeformGuestUpdate(response({
      first_name: "Amelia", last_name: "Drake", venmo_handle: "amelia",
      mobile_number: "+1 555 0100", dietary_restrictions: "Dairy",
    }));
    expect(update.instagramUrl).toBeUndefined();
    expect(update.favoriteCocktails).toBeUndefined();
  });

  it("rejects a different form and duplicate field answers", () => {
    expect(() => parseTypeformGuestUpdate({ ...response({}), form_response: { ...response({}).form_response, form_id: "other" } }))
      .toThrow(InvalidTypeformResponseError);
    const duplicate = response({ first_name: "Amelia" });
    duplicate.form_response.answers.push(duplicate.form_response.answers[0]!);
    expect(() => parseTypeformGuestUpdate(duplicate)).toThrow(InvalidTypeformResponseError);
  });
});
