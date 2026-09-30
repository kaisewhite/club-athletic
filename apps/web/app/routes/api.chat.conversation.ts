import { handleChatRoute, type ChatRouteArgs } from "../../src/lib/chat/runtime/http.server";
export function loader(args: ChatRouteArgs) { return handleChatRoute("conversation", args); }
