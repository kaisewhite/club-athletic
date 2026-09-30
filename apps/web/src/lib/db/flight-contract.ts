import { z } from "zod";

const text = z.string().trim().min(1).max(200).nullable();
/** The single extraction contract, also reusable by the later CMA tool registry.
 * Null preserves uncertainty. Selection is explicit; connecting legs remain in provenance. */
export const flightCandidateSchema = z.strictObject({
  direction: z.enum(["INBOUND", "OUTBOUND"]).nullable(),
  selectedForTrip: z.boolean().nullable(),
  airline: text,
  flightNumber: text,
  origin: z.string().regex(/^[A-Z]{3}$/).nullable(),
  destination: z.string().regex(/^[A-Z]{3}$/).nullable(),
  departureDate: text,
  departureTime: text,
  arrivalDate: text,
  arrivalTime: text,
  bookingReference: text,
  visiblePassengerName: text,
  confidence: z.number().min(0).max(1).nullable(),
});
export const flightExtractionSchema = z.strictObject({
  legs: z.array(flightCandidateSchema).max(20).nullable(),
});
export type FlightCandidate = z.infer<typeof flightCandidateSchema>;
export type FlightExtraction = z.infer<typeof flightExtractionSchema>;

const readbackPayloadSchema = z.object({
  intakeReadback: z.strictObject({ pendingExtractionId: z.string().min(1), version: z.number().int().positive() }),
});
/** Identity stamped on the immutable assistant event, not relabeled on the
 * pending row later. Reusing an old read-back after a correction must fail. */
export function matchesIntakeReadback(payload: unknown, pendingExtractionId: string, version: number): boolean {
  const parsed = readbackPayloadSchema.safeParse(payload);
  return parsed.success && parsed.data.intakeReadback.pendingExtractionId === pendingExtractionId &&
    parsed.data.intakeReadback.version === version;
}

/** Deliberately conservative: sentences containing a correction are not consent. */
export function isAffirmativeFlightConfirmation(content: string): boolean {
  return /^(yes|yep|yup|correct|confirmed|that(?:'s| is) correct|looks good|yes[, ]+(?:please|correct|that(?:'s| is) correct|save(?: it| them| these flights)?))[.!\s]*$/i.test(content.trim());
}

export function isExplicitGuestCreationConsent(content: string): boolean {
  return /^(?:yes[, ]+)?(?:please )?(?:add|create) (?:me|my guest record|a guest record for me)(?: please)?[.!\s]*$/i.test(content.trim());
}
