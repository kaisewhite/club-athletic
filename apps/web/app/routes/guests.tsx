import { getGuestInstagramProfiles } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { GuestInstagramAvatar } from "../components/guest-instagram-preview";
import { CopyAllLinksButton } from "../components/copy-all-links-button";
import { guestInstagramProfiles } from "../lib/guest-instagrams";
import type { Route } from "./+types/guests";

type GuestProfile = { displayName: string; href?: string };

export async function loader() {
  const guestProfiles = await getGuestInstagramProfiles();
  const profiles = new Map<string, GuestProfile>(guestInstagramProfiles.map((profile) => [profile.displayName, profile] as const));
  guestProfiles.forEach((profile) => profiles.set(profile.displayName, profile));
  return { guestProfiles: [...profiles.values()] };
}

export default function Guests({ loaderData }: Route.ComponentProps) {
  return <section aria-labelledby="guests-heading">
    <PageHeading id="guests-heading" sub="Everyone on the trip. Guests with Instagram profiles link directly.">Guests</PageHeading>
    <div className="guest-actions"><CopyAllLinksButton links={loaderData.guestProfiles.flatMap(({ href }) => href ? [href] : [])} /></div>
    <div className="link-list guest-list">
      {loaderData.guestProfiles.map(({ displayName, href }) => <div className="guest-link-entry" key={displayName}>
        {href ? <a className="link-row" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${displayName} on Instagram`}>
          <GuestInstagramAvatar profileUrl={href} />
          <span className="link-name">{displayName}</span>
          <span className="text-accent" aria-hidden="true">↗</span>
        </a> : <div className="link-row" aria-label={`${displayName}, no Instagram profile configured`}>
          <span className="guest-avatar-placeholder" aria-hidden="true">—</span>
          <span className="link-name">{displayName}</span>
          <span className="guest-profile-note">No Instagram profile</span>
        </div>}
      </div>)}
    </div>
  </section>;
}
