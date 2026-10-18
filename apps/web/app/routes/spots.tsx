import { getOpenSpots } from "@/lib/db/repository.server";
import { getEurUsdRate } from "../lib/exchange-rates.server";
import { DetailList } from "../components/trip-details";
import type { Route } from "./+types/spots";

export async function loader() {
  const data = await getOpenSpots();
  return {
    pricing: data.pricing, openCount: data.openCount,
    usdRate: data.pricing.currency === "EUR" ? await getEurUsdRate() : null,
    openRooms: data.openRooms.map(({ id, shortName, floorName, openCount, priceLabel, pricePerPerson, description }) => ({
      id, shortName, floorName, openCount, priceLabel, pricePerPerson: pricePerPerson === null ? null : Number(pricePerPerson), description,
    })),
  };
}

export default function Spots({ loaderData: data }: Route.ComponentProps) {
  const formatBreakdownPrice = (amount: number) => new Intl.NumberFormat("en-IE", {
    style: "currency", currency: data.pricing.currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2,
  }).format(amount);
  const formatBreakdownUsd = data.usdRate ? new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) : null;
  const breakdownPrice = (amount: number) => <>{formatBreakdownPrice(amount)}{formatBreakdownUsd && <span className="price-breakdown-usd"> / {formatBreakdownUsd.format(amount * data.usdRate!.rate)}</span>}</>;
  const roomPrice = (amount: number | null) => amount === null ? null : <>{formatBreakdownPrice(amount)}{formatBreakdownUsd && <span className="price-breakdown-usd"> / {formatBreakdownUsd.format(amount * data.usdRate!.rate)}</span>}</>;
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const usdRange = data.usdRate && `${usd.format(data.pricing.minPerPerson * data.usdRate.rate)}–${usd.format(data.pricing.maxPerPerson * data.usdRate.rate)}`;
  const rateDate = data.usdRate && new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${data.usdRate.date}T00:00:00Z`));

  return <section aria-label="Pricing">
    <div className="spots-hero">
      <div className="spots-heading">Open spots <span className="spots-count">{data.openCount}</span></div>
      <dl className="spots-currencies">
        <div className="spots-currency"><dt>{data.pricing.currency} · {data.pricing.description}</dt><dd className="spots-price">{data.pricing.rangeLabel}</dd></div>
        {data.pricing.currency === "EUR" && <div className="spots-currency"><dt>Estimated USD price · {data.pricing.description}</dt>
          <dd className="spots-price spots-price-usd">{usdRange ? <>≈ {usdRange}<small className="spots-rate-date">ECB rate · {rateDate}</small></> : <span className="spots-usd-unavailable">USD rate unavailable</span>}</dd>
        </div>}
      </dl>
    </div>
    <div className="detail-grid">
      <div className="detail-card"><h3 className="detail-kicker">Included in the price</h3><DetailList items={data.pricing.includes} />
        <p className="detail-note" style={{ marginTop: 12 }}>Not included: {data.pricing.excludes.join(", ")}.</p>
        {data.pricing.breakdown && <>
          <h4 className="detail-kicker price-breakdown-heading">Price breakdown</h4>
          <dl className="price-breakdown" aria-label="Price breakdown">
            <div className="price-breakdown-row"><dt>Room rate</dt><dd className="price-breakdown-muted">Depends on the room</dd></div>
            <div className="price-breakdown-row"><dt>Taxes</dt><dd>{breakdownPrice(data.pricing.breakdown.taxes)}</dd></div>
            <div className="price-breakdown-row"><dt>Shuttle</dt><dd>{breakdownPrice(data.pricing.breakdown.shuttle)}</dd></div>
            <div className="price-breakdown-row"><dt>Incidentals</dt><dd>{breakdownPrice(data.pricing.breakdown.incidentals)}</dd></div>
            <div className="price-breakdown-row"><dt>Chef</dt><dd>{breakdownPrice(data.pricing.breakdown.chef)}</dd></div>
          </dl>
          {data.pricing.note && <p className="detail-note" style={{ marginTop: 12 }}>{data.pricing.note}</p>}
        </>}
      </div>
      <div className="detail-card"><h3 className="detail-kicker" style={{ marginBottom: 6 }}>Open rooms</h3>
        {data.openRooms.map((room) => <div className="open-room" key={room.id}>
          <div className="open-room-text">
            <span className="open-room-name">{room.shortName} <span className="open-room-floor">· {room.floorName}</span></span>
            {room.pricePerPerson === null ? <span className="open-room-price">Price depends on the room</span> : <span className="open-room-price">{roomPrice(room.pricePerPerson)} per person</span>}
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
