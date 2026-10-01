import { Link, useOutletContext } from "react-router";
import { getSchedule } from "@/lib/db/repository.server";
import type { Route } from "./+types/overview";

import { ChatPanel } from "../components/chat/chat-panel";
import { ChatErrorBoundary } from "../components/chat/chat-error-boundary";

export async function loader(_args?: Route.LoaderArgs) {
  const schedule = await getSchedule();
  // Return display data only; Prisma Decimal fields must not cross the loader boundary.
  return {
    week: schedule.map((day) => ({
      id: day.id, dow: day.dow, number: day.dayNumber, event: day.isOpen ? "TBD" : day.eventTitle,
    })),
  };
}

export default function Overview({ loaderData: data }: Route.ComponentProps) {
  const { chatResetVersion, resettingChat, selectedConversationId, selectConversation } = useOutletContext<{
    chatResetVersion: number; newChat: () => void; resettingChat: boolean;
    selectedConversationId: string | null; selectConversation: (id: string | null) => void;
  }>();
  return (
    <section className="overview" aria-labelledby="overview-heading">
      <ChatErrorBoundary key={chatResetVersion}><ChatPanel initialConversation={null} selectedId={resettingChat ? null : selectedConversationId} onConversationIdChange={selectConversation}>
      <div className="overview-content">
        <section className="home-schedule" aria-label="Schedule for the week">
          <div className="week-heading">
            <span className="section-label">This week</span>
            <div className="schedule-ticker-actions">
              <Link to="/schedule">Full schedule →</Link>
            </div>
          </div>
          <ol className="sr-only">
            {data.week.map(day => <li key={day.id}>
              {day.dow} {day.number}: {day.event}.
            </li>)}
          </ol>
          <div className="schedule-ticker-window" aria-hidden="true">
            <div className="schedule-ticker-track">
              {[false, true].map(copy => (
                <ol className="schedule-ticker-sequence" key={String(copy)} data-copy={copy ? "true" : undefined}>
                  {data.week.map(day => <li className="schedule-ticker-item" key={day.id}>
                    <span className="ticker-date">{day.dow} {day.number}</span>
                    <span className="ticker-event">{day.event}</span>
                  </li>)}
                </ol>
              ))}
            </div>
          </div>
        </section>
        <div className="home-welcome">
          <h1 id="overview-heading">How can I help with the trip?</h1>
          <p>Ask about the schedule, rooms, travel, or anything else you need.</p>
          <Link to="/faq">Browse frequently asked questions <span aria-hidden="true">→</span></Link>
        </div>
      </div>
      </ChatPanel></ChatErrorBoundary>
    </section>
  );
}
