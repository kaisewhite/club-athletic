import { handleChatRoute, type ChatRouteArgs } from "../../src/lib/chat/runtime/http.server";
export function action(args: ChatRouteArgs) { return handleChatRoute("messages", args); }
