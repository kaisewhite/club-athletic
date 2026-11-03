import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import { z } from "zod";
import { getChalet } from "@/lib/db/repository.server";
import { DetailList, PageHeading } from "../components/trip-details";
import { RoomSharingFaq } from "../components/room-sharing-faq";
import type { Route } from "./+types/chalet";
import { ArrowText } from "../components/arrow-text";

const amenitiesSchema = z.object({ private: z.array(z.string()), shared: z.array(z.string()) });

export async function loader() {
  const { property: { lat: _lat, lng: _lng, ...property }, links } = await getChalet();
  return {
    property,
    amenities: amenitiesSchema.parse(property.amenities),
    // The listings are Link rows in the "Chalet" group — the same rows the Links
    // page shows — so there is one place a listing is named and pointed at.
    listings: links.map(({ id, label, href, note }) => ({ id, label, href, note })),
  };
}

export default function Chalet({ loaderData: { property, amenities, listings } }: Route.ComponentProps) {
  // The room qualifier is part of the editable property description in the seed.
  const roomsNote = property.description?.match(/Most rooms[^.]*\.?/)?.[0];
  return <section aria-labelledby="chalet-heading">
    <PageHeading id="chalet-heading" sub="Two apartments, F12 and F21, joined as one chalet."><ArrowText>{property.name}</ArrowText></PageHeading>
    {property.mapsUrl ? <a className="chalet-address" href={property.mapsUrl} target="_blank" rel="noopener noreferrer">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
      <span><ArrowText>{property.address}</ArrowText></span><span className="maps-label">Maps <ArrowUpRight size="1em" aria-hidden="true" /></span>
    </a> : <div className="chalet-address"><span><ArrowText>{property.address}</ArrowText></span></div>}
    <div className="stat-grid" aria-label="Chalet facts">
      <div className="stat"><div className="stat-label">Size</div><div className="stat-value">{property.sizeSquareMeters} m²</div></div>
      <div className="stat"><div className="stat-label">Levels</div><div className="stat-value">{property.floorCount}</div></div>
      <div className="stat"><div className="stat-label">Bedrooms</div><div className="stat-value">{property.bedroomCount}</div></div>
      <div className="stat"><div className="stat-label">Sleeps</div><div className="stat-value">{property.sleepsMin}–{property.sleepsMax}</div></div>
    </div>
    <div className="detail-grid">
      <div className="detail-card"><h3 className="detail-kicker">In the chalet</h3><DetailList items={amenities.private} /></div>
      <div className="detail-card"><h3 className="detail-kicker">Shared in the residence</h3><DetailList items={amenities.shared} /></div>
    </div>
    {(roomsNote ?? property.description) && <p className="detail-note"><ArrowText>{roomsNote ?? property.description!}</ArrowText></p>}
    <RoomSharingFaq />
    <section className="chalet-listings" aria-labelledby="chalet-listings-heading">
      <h3 id="chalet-listings-heading" className="detail-kicker">Listings</h3>
      <p className="chalet-listings-intro">The chalet, each apartment, and the residence on their own sites.</p>
      <div className="link-list">
        {listings.map((link) => <a className="link-row" key={link.id} href={link.href} target="_blank" rel="noopener noreferrer">
          <span><span className="link-name"><ArrowText>{link.label}</ArrowText></span>{link.note && <span className="link-group"><ArrowText>{link.note}</ArrowText></span>}</span>
          <span className="text-accent" aria-hidden="true"><ArrowUpRight size="1em" /></span>
        </a>)}
      </div>
    </section>
  </section>;
}
