import { getGuestTasks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { GuestInstagramLink } from "../components/guest-instagram-link";
import type { Route } from "./+types/tasks";

export async function loader() {
  return getGuestTasks();
}

export default function Tasks({ loaderData: data }: Route.ComponentProps) {
  return <section aria-labelledby="tasks-heading">
    <PageHeading id="tasks-heading" sub={<>Flight booking and payment status for {data.guestCount} confirmed guests. <strong className="text-text">{data.paidCount}</strong> paid.</>}>Who’s done what</PageHeading>
    <nav className="readiness-links" aria-label="Trip readiness pages">
      <a href="/flights">Flights <span aria-hidden="true">→</span></a>
      <a href="/spots">Rooms and prices <span aria-hidden="true">→</span></a>
    </nav>
    <section className="readiness-section" aria-labelledby="readiness-table-heading">
    <div className="travel-chapter-heading"><span>01</span><h3 id="readiness-table-heading">Group flight and payment status</h3></div>
    <div className="detail-table-wrap"><table className="detail-table task-table" aria-label="Guest flight and payment status">
      <thead><tr><th scope="col">Guest</th><th scope="col">Flight</th><th scope="col">Payment</th></tr></thead>
      <tbody>{data.guests.map((guest) => <tr key={guest.id}>
        <th scope="row"><GuestInstagramLink displayName={guest.displayName} instagramUrl={guest.instagramUrl} /></th>
        <td data-label="Flight"><span className="task-status" data-done={guest.hasFlights}>{guest.hasFlights ? "Booked" : "—"}</span></td>
        <td data-label="Payment"><span className="task-status" data-done={guest.paid}>{guest.paid ? "Paid" : "—"}</span></td>
      </tr>)}</tbody>
    </table></div>
    </section>
  </section>;
}
