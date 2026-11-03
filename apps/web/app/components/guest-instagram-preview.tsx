import { useEffect, useRef } from "react";
import { guestInstagramHandle } from "../lib/guest-instagrams";

/** Show a cached Instagram profile photo, with initials when Instagram has no public image. */
export function GuestInstagramAvatar({ profileUrl, displayName }: { profileUrl: string; displayName: string }) {
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const handle = guestInstagramHandle(profileUrl);
  const image = useRef<HTMLImageElement>(null);
  const fallBack = (img: HTMLImageElement) => {
    if (img.dataset.dynamicFallback !== "true") {
      img.dataset.dynamicFallback = "true";
      img.src = `/api/guest-avatars/${encodeURIComponent(handle)}`;
      return;
    }
    img.hidden = true;
    const fallback = img.previousElementSibling;
    if (fallback instanceof HTMLElement) fallback.hidden = false;
  };
  // A server-rendered image can 404 before hydration attaches onError; that event is not replayed.
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) fallBack(image.current);
  }, []);
  return <>
    <span className="guest-avatar-placeholder" aria-hidden="true" hidden>{initials}</span>
    <img
      ref={image}
      className="guest-instagram-avatar"
      src={`/guest-avatars/${handle}.jpg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={(event) => fallBack(event.currentTarget)}
    />
  </>;
}
