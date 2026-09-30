import { getOpenSpots } from "@/lib/db/repository.server";
import { DetailList } from "../components/trip-details";
import type { Route } from "./+types/spots";

export async function loader() {
  const data = await getOpenSpots();
  return {
    pricing: data.pricing, openCount: data.openCount,
    openRooms: data.openRooms.map(({ id, shortName, floorName, openCount, priceLabel, description }) => ({
      id, shortName, floorName, openCount, priceLabel, description,
    })),
  };
}

export default function Spots({ loaderData: data }: Route.ComponentProps) {
  const formatBreakdownPrice = (amount: number) => new Intl.NumberFormat("en-IE", {
    style: "currency", currency: data.pricing.currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2,
  }).format(amount);

  return <section aria-label="Pricing">
    <div className="spots-hero">
      <div className="spots-kicker">Spots still open</div>
      <div className="spots-figures"><div className="spots-count">{data.openCount}</div>
        <div><div className="spots-price">{data.pricing.rangeLabel}</div><div className="spots-price-sub">{data.pricing.description}</div></div>
      </div>
    </div>
    <div className="detail-grid">
      <div className="detail-card"><h3 className="detail-kicker">Included</h3><DetailList items={data.pricing.includes} />
        <p className="detail-note" style={{ marginTop: 12 }}>Not included: {data.pricing.excludes.join(", ")}.</p>
        {data.pricing.breakdown && <>
          <h4 className="detail-kicker price-breakdown-heading">How the all-in price is built</h4>
          <dl className="price-breakdown" aria-label="How the all-in price is built">
            <div className="price-breakdown-row"><dt>Room rate</dt><dd className="price-breakdown-muted">varies by room</dd></div>
            <div className="price-breakdown-row"><dt>Taxes</dt><dd>{formatBreakdownPrice(data.pricing.breakdown.taxes)}</dd></div>
            <div className="price-breakdown-row"><dt>Shuttle</dt><dd>{formatBreakdownPrice(data.pricing.breakdown.shuttle)}</dd></div>
            <div className="price-breakdown-row"><dt>Incidentals</dt><dd>{formatBreakdownPrice(data.pricing.breakdown.incidentals)}</dd></div>
            <div className="price-breakdown-row"><dt>Chef</dt><dd>{formatBreakdownPrice(data.pricing.breakdown.chef)}</dd></div>
          </dl>
        </>}
      </div>
      <div className="detail-card"><h3 className="detail-kicker" style={{ marginBottom: 6 }}>Where the spots are</h3>
        {data.openRooms.map((room) => <div className="open-room" key={room.id}>
          <div className="open-room-text">
            <span className="open-room-name">{room.shortName} <span className="open-room-floor">· {room.floorName}</span></span>
            <span className="open-room-price">{room.priceLabel} per person</span>
            {room.description && <span className="open-room-note">{room.description}</span>}
          </div>
          <span className="open-room-count">{room.openCount}</span>
        </div>)}
      </div>
    </div>
    {/* Last thing in the section, under both cards. Owner, 2026-09-28: "add this
        image underneath everything else… people can see what is actually left."
        The open spots are all bunks, and the two bunk rooms are the bottom-left
        and bottom-right frames, so a guest reading the counts above can see the
        beds they would actually be claiming. */}
    <figure className="chalet-gallery">
      <figcaption>Inside the chalet</figcaption>
      <img src="/chalet-rooms.webp" alt="Six photos of Chalet Falcon Lodge F: the lounge and fireplace, the living area onto the balcony, the master double, the children's quad bunk room, a double bedroom, and the bunk cabin." width={1536} height={1024} />
    </figure>
  </section>;
}
