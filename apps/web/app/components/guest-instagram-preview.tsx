import { guestInstagramHandle } from "../lib/guest-instagrams";

/** Show a cached Instagram profile photo, with initials when Instagram has no public image. */
export function GuestInstagramAvatar({ profileUrl, displayName }: { profileUrl: string; displayName: string }) {
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return <>
    <span className="guest-avatar-placeholder" aria-hidden="true" hidden>{initials}</span>
    <img
      className="guest-instagram-avatar"
      src={`/guest-avatars/${guestInstagramHandle(profileUrl)}.jpg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={(event) => {
        event.currentTarget.hidden = true;
        const fallback = event.currentTarget.previousElementSibling;
        if (fallback instanceof HTMLElement) fallback.hidden = false;
      }}
    />
  </>;
}
