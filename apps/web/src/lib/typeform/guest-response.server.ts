import { z } from "zod";

export const TYPEFORM_GUEST_FORM_ID = "s7gvWdIF";

const FIELD_MAP = {
  first_name: { id: "DShYC3NuIr95", type: "short_text" },
  last_name: { id: "bIn6j2D7WewD", type: "short_text" },
  venmo_handle: { id: "SXtc36v2nIhc", type: "short_text" },
  instagram_handle: { id: "YUkKknnPoSgl", type: "short_text" },
  mobile_number: { id: "gOk3Edpu3bwj", type: "phone_number" },
  dietary_restrictions: { id: "N5JnH5AJOERl", type: "long_text" },
  favorite_cocktails: { id: "m37BQpxVwI6N", type: "long_text" },
} as const;

const answerSchema = z.object({
  type: z.string(),
  field: z.object({ id: z.string(), ref: z.string().optional(), type: z.string().optional() }).passthrough(),
}).passthrough();

const payloadSchema = z.object({
  event_type: z.literal("form_response"),
  form_response: z.object({
    form_id: z.string(),
    token: z.string().min(1).max(128),
    submitted_at: z.string().datetime({ offset: true }),
    answers: z.array(answerSchema),
  }).passthrough(),
}).passthrough();

export class InvalidTypeformResponseError extends Error {}

export type TypeformGuestUpdate = {
  responseId: string;
  formId: string;
  submittedAt: Date;
  firstName: string;
  lastName: string;
  venmoHandle: string;
  phone: string;
  dietaryNotes: string | null;
  instagramUrl?: string | null;
  favoriteCocktails?: string | null;
};

function textAnswer(
  answers: Map<string, z.infer<typeof answerSchema>>,
  ref: keyof typeof FIELD_MAP,
  options: { required: boolean; maxLength: number },
): string | null | undefined {
  const answer = answers.get(ref);
  if (!answer) {
    if (options.required) throw new InvalidTypeformResponseError(`Missing ${ref}.`);
    return undefined;
  }
  const expected = FIELD_MAP[ref];
  if (answer.field.type && answer.field.type !== expected.type) throw new InvalidTypeformResponseError(`Unexpected type for ${ref}.`);
  const raw = ref === "mobile_number"
    ? (answer as typeof answer & { phone_number?: unknown }).phone_number
    : (answer as typeof answer & { text?: unknown }).text;
  if (typeof raw !== "string") throw new InvalidTypeformResponseError(`Invalid ${ref}.`);
  const value = raw.trim();
  if (!value && options.required) throw new InvalidTypeformResponseError(`Missing ${ref}.`);
  if (value.length > options.maxLength) throw new InvalidTypeformResponseError(`Invalid ${ref}.`);
  return value || null;
}

function instagramUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const candidate = value.trim().replace(/^@/, "");
  if (!candidate) return null;
  let handle = candidate;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())) {
        throw new InvalidTypeformResponseError("Invalid Instagram handle.");
      }
      handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch (error) {
      if (error instanceof InvalidTypeformResponseError) throw error;
      throw new InvalidTypeformResponseError("Invalid Instagram handle.");
    }
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) throw new InvalidTypeformResponseError("Invalid Instagram handle.");
  return `https://www.instagram.com/${handle}`;
}

export function parseTypeformGuestUpdate(input: unknown): TypeformGuestUpdate {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) throw new InvalidTypeformResponseError("Invalid Typeform payload.");
  const { form_response: response } = parsed.data;
  if (response.form_id !== TYPEFORM_GUEST_FORM_ID) throw new InvalidTypeformResponseError("Unexpected Typeform form.");

  const answers = new Map<string, z.infer<typeof answerSchema>>();
  const idToRef = new Map(Object.entries(FIELD_MAP).map(([ref, value]) => [value.id, ref]));
  for (const answer of response.answers) {
    const ref = (Object.keys(FIELD_MAP) as Array<keyof typeof FIELD_MAP>).find(key =>
      answer.field.ref === key || answer.field.id === FIELD_MAP[key].id,
    );
    if (!ref) continue;
    if (answer.field.id !== FIELD_MAP[ref].id && answer.field.ref !== ref) {
      throw new InvalidTypeformResponseError(`Unexpected field identity for ${ref}.`);
    }
    if (answers.has(ref)) throw new InvalidTypeformResponseError(`Duplicate answer for ${ref}.`);
    answers.set(ref, answer);
  }
  // Keep this lookup explicit so stale field IDs cannot silently map to a
  // different answer after the Typeform definition changes.
  for (const [ref, { id }] of Object.entries(FIELD_MAP)) {
    if (idToRef.get(id) !== ref) throw new InvalidTypeformResponseError("Invalid Typeform field mapping.");
  }

  const dietary = textAnswer(answers, "dietary_restrictions", { required: true, maxLength: 500 })!;
  const cocktailAnswer = textAnswer(answers, "favorite_cocktails", { required: false, maxLength: 300 });
  return {
    responseId: response.token,
    formId: response.form_id,
    submittedAt: new Date(response.submitted_at),
    firstName: textAnswer(answers, "first_name", { required: true, maxLength: 80 })!,
    lastName: textAnswer(answers, "last_name", { required: true, maxLength: 80 })!,
    venmoHandle: textAnswer(answers, "venmo_handle", { required: true, maxLength: 100 })!,
    phone: textAnswer(answers, "mobile_number", { required: true, maxLength: 80 })!,
    dietaryNotes: /^none\.?$/i.test(dietary) ? null : dietary,
    instagramUrl: instagramUrl(textAnswer(answers, "instagram_handle", { required: false, maxLength: 100 })),
    ...(cocktailAnswer !== undefined ? { favoriteCocktails: /^none\.?$/i.test(cocktailAnswer ?? "") ? null : cocktailAnswer } : {}),
  };
}
