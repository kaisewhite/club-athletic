import { getLinks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import { GuestInstagramAffordance } from "../components/guest-instagram-link";
import { guestInstagramProfiles } from "../lib/guest-instagrams";
import type { Route } from "./+types/links";

export async function loader() {
  return { links: await getLinks() };
}

/**
 * Grouped, and every link says what it is for. Owner, 2026-09-29: "It's not
 * really obvious what each one is." The group, label and description are all
 * the Link row's; the page only arranges them.
 */
export default function Links({ loaderData }: Route.ComponentProps) {
  const groups = [...new Set(loaderData.links.map((link) => link.group))];
  return <section aria-labelledby="links-heading">
    <PageHeading id="links-heading" sub="Everything you might need to open, and what each one is for.">Links</PageHeading>
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
        {guestInstagramProfiles.map(({ displayName, href }) => <a className="link-row" key={displayName} href={href} target="_blank" rel="noopener noreferrer" data-group="Guests" aria-label={`${displayName} on Instagram`}>
          <span><GuestInstagramAffordance displayName={displayName} className="link-name" /><span className="link-group">Instagram profile</span></span>
          <span className="text-accent" aria-hidden="true">↗</span>
        </a>)}
      </div>
    </section>
  </section>;
}
