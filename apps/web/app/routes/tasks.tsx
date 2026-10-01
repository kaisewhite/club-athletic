import { getGuestTasks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/tasks";

export async function loader() {
  return getGuestTasks();
}

export default function Tasks({ loaderData: data }: Route.ComponentProps) {
  return <section aria-labelledby="tasks-heading">
    <PageHeading id="tasks-heading" sub={<>Flight booking and payment status for {data.guestCount} confirmed guests. <strong className="text-text">{data.paidCount}</strong> paid.</>}>Who’s done what</PageHeading>
    <div className="detail-table-wrap"><table className="detail-table task-table" aria-label="Guest flight and payment status">
      <thead><tr><th scope="col">Guest</th><th scope="col">Flight</th><th scope="col">Payment</th></tr></thead>
      <tbody>{data.guests.map((guest) => <tr key={guest.id}>
        <th scope="row">{guest.displayName}</th>
        <td data-label="Flight"><span className="task-status" data-done={guest.hasFlights}>{guest.hasFlights ? "Booked" : "—"}</span></td>
        <td data-label="Payment"><span className="task-status" data-done={guest.paid}>{guest.paid ? "Paid" : "—"}</span></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
