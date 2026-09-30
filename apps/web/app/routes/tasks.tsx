import { getGuestTasks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/tasks";

const taskLabels = { FLIGHT: ["Flight", "Flight booked"], PAYMENT: ["Payment", "Paid"], DETAILS: ["Details", "Details in"] } as const;
const taskOrder = ["FLIGHT", "PAYMENT", "DETAILS"] as const;

export async function loader() {
  return getGuestTasks();
}

export default function Tasks({ loaderData: data }: Route.ComponentProps) {
  return <section aria-labelledby="tasks-heading">
    <PageHeading id="tasks-heading" sub={<>Status from the trip database, updated by the organizer. <strong className="text-text">{data.doneCount}</strong> of {data.totalTasks} complete.</>}>Who’s done what</PageHeading>
    <div className="task-list">{data.guests.map((guest) => <div className="task-row" key={guest.id}>
      <div className="task-name">{guest.displayName}</div><div className="task-pills">
        {taskOrder.map((type) => {
          const task = guest.tasks.find((item) => item.type === type);
          return task ? <span className="task-pill" key={task.id} data-done={task.done} aria-label={`${taskLabels[type][0]}: ${task.done ? "complete" : "incomplete"}`}>{taskLabels[type][task.done ? 1 : 0]}</span> : <span className="task-pill" key={type}>{taskLabels[type][0]}: not recorded</span>;
        })}
      </div>
    </div>)}</div>
  </section>;
}
