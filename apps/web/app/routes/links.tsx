import { getGuestInstagramProfiles, getLinks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { GuestInstagramAvatar } from "../components/guest-instagram-preview";
import { guestInstagramProfiles } from "../lib/guest-instagrams";
import type { Route } from "./+types/links";

export async function loader() {
  const [links, guestProfiles] = await Promise.all([getLinks(), getGuestInstagramProfiles()]);
  const profiles = new Map(guestInstagramProfiles.map((profile) => [profile.displayName, profile]));
  guestProfiles.forEach((profile) => profiles.set(profile.displayName, profile));
  return { links, guestProfiles: [...profiles.values()] };
}

/**
 * Grouped, and every link says what it is for. Owner, 2026-09-29: "It's not
 * really obvious what each one is." The group, label and description are all
 * the Link row's; the page only arranges them.
 */
export default function Links({ loaderData }: Route.ComponentProps) {
  const groups = [...new Set(loaderData.links.map((link) => link.group))];
  return <section aria-labelledby="links-heading">
    <PageHeading id="links-heading" sub="Links you may need, grouped by purpose.">Links</PageHeading>
    {groups.map((group) => <section key={group} className="link-section" aria-labelledby={`links-${group}`}>
      <h3 id={`links-${group}`} className="detail-kicker">{group}</h3>
      <div className="link-list">
        {loaderData.links.filter((link) => link.group === group).map((link) => <a className="link-row" key={link.id} href={link.href} target="_blank" rel="noopener noreferrer" data-group={link.group}>
          <span><span className="link-name">{link.label}</span>{link.note && <span className="link-group">{link.note}</span>}</span>
          <span className="text-accent" aria-hidden="true">↗</span>
        </a>)}
      </div>
    </section>)}
    <section className="link-section" aria-labelledby="links-guests">
      <h3 id="links-guests" className="detail-kicker">Guests</h3>
      <div className="link-list">
        {loaderData.guestProfiles.map(({ displayName, href }) => <div className="guest-link-entry" key={displayName}>
          <a className="link-row" href={href} target="_blank" rel="noopener noreferrer" data-group="Guests" aria-label={`${displayName} on Instagram`}>
            <GuestInstagramAvatar profileUrl={href} />
            <span><span className="link-name">{displayName}</span><span className="link-group">Instagram · @{href.split("/").filter(Boolean).pop()}</span></span>
            <span className="text-accent" aria-hidden="true">↗</span>
          </a>
        </div>)}
      </div>
    </section>
  </section>;
}
