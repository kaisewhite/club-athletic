import { useOutletContext } from "react-router";

import { ChatPanel } from "../components/chat/chat-panel";
import { ChatErrorBoundary } from "../components/chat/chat-error-boundary";
import { tripPageMeta } from "../lib/social-meta";

export function meta() {
  return tripPageMeta({ path: "/chat", title: "Trip assistant · Méribel ’27 — Club Athletic", description: "Ask the Club Athletic trip assistant about Méribel dates, chalet, flights, transfers, and plans." });
}

/** The trip concierge. It used to sit under the home page's schedule; it now
 * has the page to itself. The shell still owns the in-session conversation
 * selection, so leaving for another page and coming back keeps the thread. */
export default function Chat() {
  const { chatResetVersion, resettingChat, selectedConversationId, selectConversation } = useOutletContext<{
    chatResetVersion: number; newChat: () => void; resettingChat: boolean;
    selectedConversationId: string | null; selectConversation: (id: string | null) => void;
  }>();
  return (
    <section className="overview" aria-labelledby="overview-heading">
      <ChatErrorBoundary key={chatResetVersion}>
        <ChatPanel initialConversation={null} selectedId={resettingChat ? null : selectedConversationId} onConversationIdChange={selectConversation}>{null}</ChatPanel>
      </ChatErrorBoundary>
    </section>
  );
}
