import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js/min";
import { z } from "zod";

const cleanText = (max: number, label: string) => z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), `${label} contains unsupported characters.`);

function normalizeInstagram(value: string) {
  const candidate = value.trim().replace(/^@/, "");
  if (!candidate) return null;
  let handle = candidate;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())) return null;
      handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch { return null; }
  }
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}` : null;
}

export const guestDetailsSchema = z.object({
  firstName: cleanText(80, "First name"),
  lastName: cleanText(80, "Last name"),
  phone: z.string().trim().min(1, "Mobile / WhatsApp number is required.").max(64, "Enter a valid phone number.")
    .refine((value) => isValidPhoneNumber(value, "US"), "Enter a valid phone number, including the country code if needed.")
    .transform((value) => parsePhoneNumber(value, "US").number),
  venmoHandle: cleanText(100, "Venmo handle").refine((value) => !/\s/.test(value), "Enter your Venmo handle without spaces."),
  instagramHandle: z.string().trim().max(100, "Instagram handle must be 100 characters or fewer.")
    .refine((value) => !value || normalizeInstagram(value) !== null, "Enter an Instagram handle or profile link."),
  dietaryNotes: cleanText(500, "Dietary restrictions").transform((value) => /^none\.?$/i.test(value) ? null : value),
  favoriteCocktails: cleanText(300, "Favorite cocktails").transform((value) => /^none\.?$/i.test(value) ? null : value),
}).strict();

export const guestDetailsSubmissionSchema = guestDetailsSchema.extend({
  submissionId: z.string().uuid("Refresh the page and try again."),
}).strict();

export type GuestDetails = z.output<typeof guestDetailsSchema>;

export function instagramProfileUrl(value: string) {
  return normalizeInstagram(value);
}
