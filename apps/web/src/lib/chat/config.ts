// Ported constants: edge API config, send/start chat and chat retention config.
export const SSE_HEARTBEAT_MS = 15_000;
export const MAX_CHAT_MESSAGE_CHARS = 8192;
export const MAX_CHAT_OPENING_MESSAGE_CHARS = 8192;
export const CHAT_RETENTION_DAYS = 30;
export const CONVERSATION_DETAILS_EVENT_LIMIT = 200;
export const CONVERSATION_EVENT_REPLAY_PAGE_SIZE = 200;
export { CHAT_SEND_ACK_TIMEOUT_MS } from "./chat-state";
// Upload size, rate limits and pending-intake expiry belong to later tasks/Q9.
