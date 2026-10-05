// Owner, 2026-09-29: "only put something for the days where we actually have
// chefs." A meal the trip does not serve reads the same whether it is skipped
// or left to the guest — the chef page is about the chef.
export const mealLabel = { CHEF: "Chef", NONE: "—", OWN: "—" } as const;

export interface ScheduleEntry { key: string; time: string | null; title: string }

/**
 * One day as a list of what actually happens on it, in the order it happens.
 *
 * Breakfast, the event and dinner are all "something at a time", so they render
 * as the same row rather than the meals being a footnote under the event
 * (owner, 2026-09-28). Every time comes from the row; nothing is hardcoded here,
 * so moving dinner one evening is a Prisma Studio edit (D12), not a deploy.
 *
 * A day lists only what is happening on it. Owner, 2026-09-28: "if there's not
 * an event for that day, stop adding it to the schedule… There's no need to add
 * dinner when there is no dinner." So:
 *
 *   - a meal earns a row only when the chef is cooking it. NONE and OWN both
 *     mean the trip is not serving that meal, and which of the two it is belongs
 *     on the chef page, which already lists every day's breakfast and dinner.
 *   - an `isOpen` day has no event — "Open — plans to be decided" is the absence
 *     of one — so it contributes no event row at all.
 *
 * A day can therefore be as short as one line (departure day) and the schedule
 * reads as a list of commitments rather than a grid with holes punched in it.
 */
export function dayEntries(day: {
  id: string; eventTitle: string; isOpen?: boolean;
  breakfast: keyof typeof mealLabel; dinner: keyof typeof mealLabel;
  breakfastAt?: string | null; dinnerAt?: string | null; eventAt?: string | null;
}): ScheduleEntry[] {
  const meal = (kind: "breakfast" | "dinner", at: string | null | undefined, value: keyof typeof mealLabel) =>
    value !== "CHEF" ? null : {
      key: `${day.id}:${kind}`,
      time: at ?? null,
      title: kind === "breakfast" ? "Breakfast" : "Dinner at the chalet",
    };
  const entries: (ScheduleEntry | null)[] = [
    meal("breakfast", day.breakfastAt, day.breakfast),
    day.isOpen ? null : { key: `${day.id}:event`, time: day.eventAt ?? null, title: day.eventTitle },
    meal("dinner", day.dinnerAt, day.dinner),
  ];
  return entries.filter((entry): entry is ScheduleEntry => entry !== null);
}

// Database DATE fields are calendar dates, not instants in the browser timezone.
export function tripDate(date: Date, weekday: "short" | "long" = "short") {
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  return `${part({ weekday })} ${part({ day: "numeric" })} ${part({ month: "short" })}`;
}
