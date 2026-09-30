import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // Infrastructure: the ALB target group in `apps/aws` probes this every 10s.
  route("health", "routes/health.ts"),
  // Unlisted trip page: ask crawlers not to index it. See routes/robots.ts.
  route("robots.txt", "routes/robots.ts"),
  route("api/chat/uploads", "routes/api.chat.uploads.ts"),
  route("api/guests/dietary", "routes/api.guests.dietary.ts"),
  route("api/chat/conversations", "routes/api.chat.conversations.ts"),
  route("api/chat/conversations/:conversationId", "routes/api.chat.conversation.ts"),
  route("api/chat/conversations/:conversationId/status", "routes/api.chat.status.ts"),
  route("api/chat/conversations/:conversationId/stream", "routes/api.chat.stream.ts"),
  route("api/chat/conversations/:conversationId/messages", "routes/api.chat.messages.ts"),
  route("api/chat/conversations/:conversationId/cancel", "routes/api.chat.cancel.ts"),
  index("routes/overview.tsx"),
  route("faq", "routes/faq.tsx"),
  route("schedule", "routes/schedule.tsx"),
  route("flights", "routes/flights.tsx"),
  route("shuttle", "routes/shuttle.tsx"),
  route("chalet", "routes/chalet.tsx"),
  route("rooms", "routes/rooms.tsx"),
  route("spots", "routes/spots.tsx"),
  route("chef", "routes/chef.tsx"),
  route("tasks", "routes/tasks.tsx"),
  route("links", "routes/links.tsx"),
] satisfies RouteConfig;
