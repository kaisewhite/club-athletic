import { Link, useOutletContext } from "react-router";
import { getSchedule } from "@/lib/db/repository.server";
import type { Route } from "./+types/overview";

import { ChatPanel } from "../components/chat/chat-panel";
import { ChatErrorBoundary } from "../components/chat/chat-error-boundary";
import { readConversationSelection } from "../lib/chat/detail-loader";
import { loader as conversationLoader } from "./api.chat.conversation";
import type { ConversationDetails } from "@/lib/chat/contracts";

export async function loader(args?: Route.LoaderArgs) {
  const selectedId = readConversationSelection(args?.request.headers.get("Cookie") ?? null);
  // Reuse Task 2's redacted resource boundary. No direct raw chat reads reach SSR.
  const chatDetail = selectedId && args ? conversationLoader({ request: args.request, params: { conversationId: selectedId } })
    .then(async response => response.ok ? { conversation: await response.json() as ConversationDetails, error: null } : { conversation: null, error: "The conversation couldn’t be loaded. Please try again." })
    .catch(() => ({ conversation: null, error: "The conversation couldn’t be loaded. Please try again." }))
    : Promise.resolve({ conversation: null, error: null });
  const schedule = await getSchedule();
  // Return display data only; Prisma Decimal fields must not cross the loader boundary.
  return {
    chat: await chatDetail,
    selectedId,
    week: schedule.map((day) => ({
      id: day.id, dow: day.dow, number: day.dayNumber, event: day.eventTitle,
    })),
  };
}

export default function Overview({ loaderData: data }: Route.ComponentProps) {
  const { chatResetVersion, resettingChat } = useOutletContext<{ chatResetVersion: number; newChat: () => void; resettingChat: boolean }>();
  return (
    <section className="overview" aria-labelledby="overview-heading">
      <ChatErrorBoundary key={chatResetVersion}><ChatPanel initialConversation={resettingChat ? null : data.chat.conversation} selectedId={resettingChat ? null : data.selectedId} loadError={resettingChat ? null : data.chat.error}>
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
