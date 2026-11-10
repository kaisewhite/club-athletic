import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js/min";
import { z } from "zod";

const cleanText = (max: number, label: string) => z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), `${label} contains unsupported characters.`);
const fullNamePart = (label: string) => z.string().trim().max(80, `${label} must be 80 characters or fewer.`)
  .superRefine((value, context) => {
    if (!value) context.addIssue({ code: "custom", message: `${label} is required.` });
    else if (!/\p{L}{2}/u.test(value)) context.addIssue({ code: "custom", message: `Enter your full ${label.toLowerCase()}, not an initial.` });
    if (/[\p{Cc}\p{Cf}]/u.test(value)) context.addIssue({ code: "custom", message: `${label} contains unsupported characters.` });
  });

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
  firstName: fullNamePart("First name"),
  lastName: fullNamePart("Last name"),
  phone: z.string().trim().min(1, "Mobile / WhatsApp number is required.").max(64, "Enter a valid phone number.")
    .refine((value) => isValidPhoneNumber(value, "US"), "Enter a valid phone number, including the country code if needed.")
    .transform((value) => parsePhoneNumber(value, "US").number),
  venmoHandle: z.string().trim().min(1, "Venmo handle is required.")
    .refine((value) => /^@?[A-Za-z0-9_-]{5,30}$/.test(value), "Enter a valid Venmo username (5–30 letters, numbers, hyphens, or underscores)."),
  instagramHandle: z.string().trim().max(100, "Instagram handle must be 100 characters or fewer.")
    .refine((value) => !value || normalizeInstagram(value) !== null, "Enter an Instagram handle or profile link."),
  dietaryNotes: cleanText(500, "Dietary restrictions").transform((value) => /^none\.?$/i.test(value) ? null : value),
  favoriteCocktails: cleanText(300, "Favorite cocktails").transform((value) => /^none\.?$/i.test(value) ? null : value),
  roomId: cleanText(100, "Room choice"),
}).strict();

export const guestDetailsSubmissionSchema = guestDetailsSchema.extend({
  submissionId: z.string().uuid("Refresh the page and try again."),
}).strict();

export type GuestDetails = z.output<typeof guestDetailsSchema>;

export function instagramProfileUrl(value: string) {
  return normalizeInstagram(value);
}
