import type { GuestTask, Spot } from "../../../prisma/generated/client";
import { z } from "zod";

const tripPricingSchema = z.object({
  minPerPerson: z.number().nonnegative(),
  maxPerPerson: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string(),
  breakdown: z.object({ taxes: z.number().nonnegative(), shuttle: z.number().nonnegative(), incidentals: z.number().nonnegative(), chef: z.number().nonnegative() }).optional(),
  note: z.string().optional(),
  includes: z.array(z.string()),
  excludes: z.array(z.string()),
}).refine((pricing) => pricing.maxPerPerson >= pricing.minPerPerson, "Invalid pricing range");

/** Shape the existing JSONB value; never substitute seed prices for missing data. */
export function getTripPricing(value: unknown) {
  const pricing = tripPricingSchema.parse(value);
  const format = new Intl.NumberFormat("en-IE", {
    style: "currency", currency: pricing.currency, maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return { ...pricing, rangeLabel: `${format.format(pricing.minPerPerson)}–${format.format(pricing.maxPerPerson)}` };
}

/** NOT_OFFERED is deliberately neither occupied nor available. */
export function countOpenSpots(spots: readonly Pick<Spot, "status">[]): number {
  return spots.filter((spot) => spot.status === "AVAILABLE").length;
}

export function summarizeTasks<T extends { tasks: readonly Pick<GuestTask, "done">[] }>(guests: readonly T[]) {
  return {
    guests: guests.map((guest) => ({
      ...guest,
      doneCount: guest.tasks.filter((task) => task.done).length,
      totalTasks: guest.tasks.length,
    })),
    doneCount: guests.reduce((sum, guest) => sum + guest.tasks.filter((task) => task.done).length, 0),
    totalTasks: guests.reduce((sum, guest) => sum + guest.tasks.length, 0),
  };
}
