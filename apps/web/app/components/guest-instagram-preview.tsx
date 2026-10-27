import { guestInstagramHandle } from "../lib/guest-instagrams";

/** Show a cached Instagram profile photo, with initials when Instagram has no public image. */
export function GuestInstagramAvatar({ profileUrl, displayName }: { profileUrl: string; displayName: string }) {
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const handle = guestInstagramHandle(profileUrl);
  return <>
    <span className="guest-avatar-placeholder" aria-hidden="true" hidden>{initials}</span>
    <img
      className="guest-instagram-avatar"
      src={`/guest-avatars/${handle}.jpg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={(event) => {
        if (event.currentTarget.dataset.dynamicFallback !== "true") {
          event.currentTarget.dataset.dynamicFallback = "true";
          event.currentTarget.src = `/api/guest-avatars/${encodeURIComponent(handle)}`;
          return;
        }
        event.currentTarget.hidden = true;
        const fallback = event.currentTarget.previousElementSibling;
        if (fallback instanceof HTMLElement) fallback.hidden = false;
      }}
    />
  </>;
}
