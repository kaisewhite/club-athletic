import { z } from "zod";
import { flightExtractionSchema } from "../../db/flight-contract";
export {
  flightCandidateSchema,
  flightExtractionSchema,
} from "../../db/flight-contract";
const id = z.string().trim().min(1).max(128).nullable();
// D4: extend the accepted extraction contract; never maintain a second leg schema.
// Null means unknown. No message IDs, trip IDs, credentials or SQL are model inputs.
export const recordFlightSchema = flightExtractionSchema.extend({
  action: z
    .enum(["extract", "identify", "readback", "confirm", "commit"])
    .nullable(),
  documentKind: z.enum(["flight_confirmation", "other"]).nullable(),
  uploadId: id,
  pendingExtractionId: id,
  version: z.number().int().positive().nullable(),
  firstName: z.string().trim().min(1).max(100).nullable(),
  lastName: z.string().trim().max(100).nullable(),
  confirmedByGuest: z.boolean().nullable(),
});
export type RecordFlightArguments = z.infer<typeof recordFlightSchema>;
export const recordFlightDescription = `Flight intake only. Use extract for an attached flight confirmation, preserving all legs and uncertainty as null. It stages candidates and REFUSES TO COMMIT. Always ask the guest's name, even if a passenger name is visible. Use identify only for a name the guest typed. Use readback to persist the exact proposed flights, then WAIT for the guest reply. Use confirm after an affirmative guest reply; it validates the stored reply against that exact version. Only then use commit with confirmedByGuest:true. A flag alone grants no authority. Supply the returned pendingExtractionId and version on every subsequent call. Corrections use extract and invalidate consent. Ask which trip leg when a direction has multiple candidates. Never supply guessed names, dates, airports or timezones. Unused fields must be null. No other domain writes are permitted.`;
