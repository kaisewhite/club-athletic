import { guestInstagramHandle } from "../lib/guest-instagrams";

/** Show the guest's actual Instagram profile photo inside the single clickable guest row. */
export function GuestInstagramAvatar({ profileUrl }: { profileUrl: string }) {
  return <img
    className="guest-instagram-avatar"
    src={`/guest-avatars/${guestInstagramHandle(profileUrl)}.jpg`}
    alt=""
    aria-hidden="true"
    loading="lazy"
    onError={(event) => { event.currentTarget.hidden = true; }}
  />;
}
