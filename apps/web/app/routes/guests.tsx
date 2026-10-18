import { getGuestInstagramProfiles } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { GuestInstagramAvatar } from "../components/guest-instagram-preview";
import { guestInstagramProfiles } from "../lib/guest-instagrams";
import type { Route } from "./+types/guests";

export async function loader() {
  const guestProfiles = await getGuestInstagramProfiles();
  const profiles = new Map(guestInstagramProfiles.map((profile) => [profile.displayName, profile]));
  guestProfiles.forEach((profile) => profiles.set(profile.displayName, profile));
  return { guestProfiles: [...profiles.values()] };
}

export default function Guests({ loaderData }: Route.ComponentProps) {
  return <section aria-labelledby="guests-heading">
    <PageHeading id="guests-heading" sub="Everyone on the trip, with a direct link to their Instagram profile.">Guests</PageHeading>
    <div className="link-list guest-list">
      {loaderData.guestProfiles.map(({ displayName, href }) => <div className="guest-link-entry" key={displayName}>
        <a className="link-row" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${displayName} on Instagram`}>
          <GuestInstagramAvatar profileUrl={href} />
          <span className="link-name">{displayName}</span>
          <span className="text-accent" aria-hidden="true">↗</span>
        </a>
      </div>)}
    </div>
  </section>;
}
