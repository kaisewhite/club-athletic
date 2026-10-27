import { guestInstagramProfiles, guestInstagramHandle } from "./guest-instagrams";
import { getGuestInstagramProfiles } from "../../src/lib/db/repository.server";
import { getInstagramAvatar, isInstagramHandle, type InstagramAvatar } from "../../src/lib/instagram-avatar.server";

type AvatarDependencies = {
  isKnownHandle?: (handle: string) => Promise<boolean>;
  getAvatar?: (handle: string) => Promise<InstagramAvatar | null>;
};

async function isKnownGuestHandle(handle: string) {
  if (guestInstagramProfiles.some((profile) => guestInstagramHandle(profile.href) === handle)) return true;
  const profiles = await getGuestInstagramProfiles();
  return profiles.some((profile) => profile.href && guestInstagramHandle(profile.href) === handle);
}

export async function guestAvatarResponse(handle: string, dependencies: AvatarDependencies = {}) {
  if (!isInstagramHandle(handle)) return new Response(null, { status: 404 });
  const isKnownHandle = dependencies.isKnownHandle ?? isKnownGuestHandle;
  if (!await isKnownHandle(handle)) return new Response(null, { status: 404 });
  const avatar = await (dependencies.getAvatar ?? getInstagramAvatar)(handle);
  if (!avatar) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=120" } });
  const body = avatar.bytes.buffer.slice(
    avatar.bytes.byteOffset,
    avatar.bytes.byteOffset + avatar.bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": avatar.contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
