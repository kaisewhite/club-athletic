import { guestAvatarResponse } from "../lib/guest-avatar-response.server";
import type { Route } from "./+types/api.guest-avatars";

export async function loader({ params }: Route.LoaderArgs) {
  return guestAvatarResponse(params.handle ?? "");
}
