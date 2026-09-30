import { getChefSummary } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { mealLabel, tripDate } from "../lib/schedule-display";
import type { Route } from "./+types/chef";
import { DietaryCell, DietaryCopyButton } from "../components/dietary-cell";
import { guestInstagramUrl } from "../lib/guest-instagrams";

export async function loader() {
  return getChefSummary();
}

export default function Chef({ loaderData: data }: Route.ComponentProps) {
  return <section aria-labelledby="chef-heading">
    <PageHeading id="chef-heading" sub={`${data.chefBreakfastCount} breakfasts and ${data.chefDinnerCount} dinners at the chalet.`}>Chef</PageHeading>
    <div className="chef-stats">
      <div className="chef-stat"><div className="chef-stat-label">First meal</div><div className="chef-stat-value">{data.firstMeal ? `${data.firstMeal.meal}, ${data.firstMeal.day.dow} ${data.firstMeal.day.dayNumber}` : "Not scheduled"}</div></div>
      <div className="chef-stat"><div className="chef-stat-label">Last dinner</div><div className="chef-stat-value">{data.lastDinner ? tripDate(data.lastDinner.date) : "Not scheduled"}</div></div>
      <div className="chef-stat"><div className="chef-stat-label">Last breakfast</div><div className="chef-stat-value">{data.lastBreakfast ? tripDate(data.lastBreakfast.date) : "Not scheduled"}</div></div>
    </div>
    {/* `chef-meal-table` and the `data-meal` labels are hooks for the mobile
        one-row-per-day layout in `trip-details.css` (TODO §2.15). They add no
        desktop styling of their own: above the 860px seam this is the same
        three-column `.detail-table` it has always been. */}
    <div className="detail-table-wrap"><table className="detail-table chef-meal-table" aria-label="Chef meal schedule">
      <thead><tr><th scope="col">Day</th><th scope="col">Breakfast</th><th scope="col">Dinner</th></tr></thead>
      <tbody>{data.scheduleDays.map((day) => <tr key={day.id}><th scope="row">{day.dow} {day.dayNumber}</th><td data-meal="Breakfast">{mealLabel[day.breakfast]}</td><td data-meal="Dinner">{mealLabel[day.dinner]}</td></tr>)}</tbody>
    </table></div>
    <p className="detail-note">Add allergies or dietary needs in the table below before the trip.</p>
    <h3 className="dietary-heading">Guest dietary requirements</h3>
    <div className="detail-table-wrap chef-dietary-card">
      <DietaryCopyButton guests={data.guests} />
      <table className="detail-table" aria-label="Guest dietary requirements">
      <thead><tr><th scope="col">Guest</th><th scope="col">Allergies / dietary needs</th></tr></thead>
      <tbody>{data.guests.map((guest) => <tr key={guest.id}><th scope="row">{guestInstagramUrl(guest.displayName)
        ? <a href={guestInstagramUrl(guest.displayName)} target="_blank" rel="noopener noreferrer">{guest.displayName}</a>
        : guest.displayName}</th><td data-label="Allergies / dietary needs"><DietaryCell guestId={guest.id} guestName={guest.displayName} dietaryNotes={guest.dietaryNotes} /></td></tr>)}</tbody>
      </table>
    </div>
  </section>;
}
