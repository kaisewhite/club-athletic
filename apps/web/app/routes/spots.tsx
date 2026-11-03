import { ArrowRight } from "@phosphor-icons/react/ssr";
import { getOpenSpots } from "@/lib/db/repository.server";
import { getEurUsdRate } from "../lib/exchange-rates.server";
import { PageHeading } from "../components/trip-details";
import { ArrowText } from "../components/arrow-text";
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

  return <section aria-labelledby="pricing-heading">
    <PageHeading id="pricing-heading" sub="The total open spots are broken down by room below. See the room guide to compare assignments.">Rooms &amp; prices</PageHeading>
    <div className="spots-hero">
      <div className="spots-open-summary">
        <div className="spots-heading"><span>Open spots</span> <span className="spots-count">{data.openCount}</span></div>
        <p>Each room below shows how many spots are currently available in that room.</p>
        <a className="spots-room-link" href="/rooms">Compare room assignments <span aria-hidden="true"><ArrowRight size="1em" /></span></a>
      </div>
      <dl className="spots-currencies">
        <div className="spots-currency"><dt>{data.pricing.currency} · <ArrowText>{data.pricing.description}</ArrowText></dt><dd className="spots-price"><ArrowText>{data.pricing.rangeLabel}</ArrowText></dd></div>
        {data.pricing.currency === "EUR" && <div className="spots-currency"><dt>Estimated USD price · <ArrowText>{data.pricing.description}</ArrowText></dt>
          <dd className="spots-price spots-price-usd">{usdRange ? <>≈ {usdRange}<small className="spots-rate-date">ECB rate · {rateDate}</small></> : <span className="spots-usd-unavailable">USD rate unavailable</span>}</dd>
        </div>}
      </dl>
      <p className="detail-note">Payment is in full; there is no deposit. If you drop out by November 15, you’ll receive a full refund. After November 15, you’ll need to find your own replacement.</p>
    </div>
    <div className="pricing-details">
      <section className="pricing-room-list" aria-labelledby="pricing-room-heading">
        <div className="pricing-room-list-heading"><h3 className="detail-kicker" id="pricing-room-heading">Available spots by room</h3><a href="/rooms">Room assignments <span aria-hidden="true"><ArrowRight size="1em" /></span></a></div>
        <table className="pricing-room-table">
          <thead><tr><th scope="col">Bedroom</th><th scope="col">Floor / door</th><th scope="col">Price per person</th><th scope="col">Availability</th></tr></thead>
          <tbody>{data.openRooms.map((room) => <tr key={room.id}>
            <th scope="row"><span className="pricing-bedroom-name">{room.shortName}</span>{room.description && <span className="pricing-bedroom-note">{room.description}</span>}</th>
            <td data-label="Floor / door"><span className="pricing-mobile-label">Floor / door</span><span>{room.floorName}</span></td>
            <td data-label="Price per person"><span className="pricing-mobile-label">Price per person</span><span>{room.pricePerPerson === null ? "Price pending" : <>{roomPrice(room.pricePerPerson)} per person</>}</span></td>
            <td data-label="Availability"><span className="pricing-mobile-label">Availability</span><span><strong>{room.openCount}</strong> {room.openCount === 1 ? "spot open" : "spots open"}</span></td>
          </tr>)}</tbody>
        </table>
      </section>
    </div>
    <section className="pricing-inclusions" aria-labelledby="pricing-inclusions-heading">
      <h3 className="detail-kicker" id="pricing-inclusions-heading">Included in the price</h3>
      <ul className="detail-list">
        {data.pricing.includes.map((item) => <li key={item}><span>{item}</span></li>)}
      </ul>
      <p className="detail-note" style={{ marginTop: 12 }}>Not included: {data.pricing.excludes.map((item, index) => <span key={`${index}-${item}`}>{index > 0 && ", "}<ArrowText>{item}</ArrowText></span>)}.</p>
      {data.pricing.breakdown && <div className="pricing-cost-breakdown">
        <h4 className="detail-kicker price-breakdown-heading">Price breakdown</h4>
        <dl className="price-breakdown" aria-label="Price breakdown">
          <div className="price-breakdown-row"><dt>Room rate</dt><dd className="price-breakdown-muted">Depends on the room</dd></div>
          <div className="price-breakdown-row"><dt>Taxes</dt><dd>{breakdownPrice(data.pricing.breakdown.taxes)}</dd></div>
          <div className="price-breakdown-row"><dt>Shuttle</dt><dd>{breakdownPrice(data.pricing.breakdown.shuttle)}</dd></div>
          <div className="price-breakdown-row"><dt>Incidentals</dt><dd>{breakdownPrice(data.pricing.breakdown.incidentals)}</dd></div>
          <div className="price-breakdown-row"><dt>Chef</dt><dd>{breakdownPrice(data.pricing.breakdown.chef)}</dd></div>
        </dl>
        {data.pricing.note && <p className="detail-note" style={{ marginTop: 12 }}><ArrowText>{data.pricing.note}</ArrowText></p>}
      </div>}
    </section>
    <div className="pricing-records">
      <details className="detail-card service-agreement">
        <summary className="pricing-record-summary">
          <span className="pricing-record-heading">
            <span className="detail-kicker">Private chef · Booked</span>
            <span className="pricing-record-title">Alps Chefs service agreement</span>
            <span className="pricing-record-meta">5 dinners · 6 breakfasts · 19 adults · €8,296.50 service total</span>
          </span>
          <span className="pricing-record-toggle" aria-hidden="true"></span>
        </summary>
        <div className="pricing-record-content">
          <p className="pricing-record-copy">Janaina Rangel · CEO &amp; Executive Chef · Alps Chefs</p>
          <p className="pricing-record-copy">Méribel Falcon, 269 Rte de l’Altiport, Les Allues, Méribel, France</p>
          <dl className="pricing-record-facts" aria-label="Private chef agreement breakdown">
            <div><dt>Original service · 12 adults</dt><dd>€4,482.00</dd></div>
            <div><dt>7 additional guests · €373.50 each</dt><dd>€2,614.50</dd></div>
            <div><dt>Chef assistant</dt><dd>€1,200.00</dd></div>
            <div><dt>Additional services total</dt><dd>€3,814.50</dd></div>
            <div className="pricing-record-total"><dt>Updated service agreement total</dt><dd>€8,296.50</dd></div>
          </dl>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Service schedule</h4>
            <p className="pricing-record-copy">5 dinners, January 30–February 3, 2027, and 6 breakfasts, January 31–February 5, 2027. Staff: chef and butler.</p>
          </div>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Service includes</h4>
            <ul className="detail-list">
              <li>Customized menus based on guest preferences</li>
              <li>Setup and professional table service</li>
              <li>Food preparation and in-property live cooking by a private chef</li>
              <li>Kitchen and dining table clean-up</li>
            </ul>
            <p className="pricing-record-copy">Not included: ingredients and beverages.</p>
          </div>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Payment schedule</h4>
            <p className="pricing-record-copy">50% upfront: €4,148.25 as the booking fee and deposit. Remaining service balance: €4,148.25, plus a separate €1,800 food-shopping credit.</p>
          </div>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Cancellation terms</h4>
            <p className="pricing-record-copy">Cancellation 30 days before the scheduled date: 50% of the booking fee and deposit will be refunded. Cancellation 0–29 days before the scheduled date: no refund.</p>
          </div>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Provider contact</h4>
            <p className="pricing-record-copy"><a href="tel:+33977217249">+33 977 217 249</a> · <a href="tel:+34686414624">+34 686 414 624</a></p>
            <p className="pricing-record-copy"><a href="mailto:alpschefs@gmail.com">alpschefs@gmail.com</a> · <a href="https://www.alpschefs.com" target="_blank" rel="noreferrer">alpschefs.com</a></p>
            <p className="pricing-record-copy">6 Rue d’Armaillé, 75017 Paris</p>
          </div>
        </div>
      </details>
      <details className="detail-card open-bar-proposal">
        <summary className="pricing-record-summary">
          <span className="pricing-record-heading">
            <span className="detail-kicker">Optional extra · Not booked</span>
            <span className="pricing-record-title">Premium open bar</span>
            <span className="pricing-record-meta">Alps Chefs · 19 guests · 2 hours · €2,090 including VAT</span>
          </span>
          <span className="pricing-record-toggle" aria-hidden="true"></span>
        </summary>
        <div className="pricing-record-content">
          <p className="detail-note">Saved for reference only. This service has not been booked and is not included in the trip price.</p>
          <dl className="pricing-record-facts" aria-label="Premium open bar offer pricing">
            <div><dt>Guests</dt><dd>19</dd></div>
            <div><dt>Service time</dt><dd>2 hours</dd></div>
            <div><dt>Price per person</dt><dd>€100</dd></div>
            <div><dt>Subtotal</dt><dd>€1,900</dd></div>
            <div><dt>VAT</dt><dd>10% · €190</dd></div>
            <div className="pricing-record-total"><dt>Total including VAT</dt><dd>€2,090</dd></div>
          </dl>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">The experience includes</h4>
            <ul className="detail-list">
              <li>Premium spirits</li>
              <li>Classic and signature cocktails</li>
              <li>Beer, water and soft drinks</li>
              <li>Fresh fruit, garnishes, ice and mixers</li>
              <li>Professional bartender and bar equipment with an elegant setup</li>
              <li>Full preparation and clean-up</li>
              <li>Attentive, discreet service throughout the event</li>
            </ul>
          </div>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Bespoke cocktail selection</h4>
            <p className="pricing-record-copy">The selection will be personalized for the group. Before the event, the bartender will contact you to learn your preferences, favorite spirits and flavors, then tailor the menu to your guests and celebration.</p>
            <p className="pricing-record-copy">Specialties include Aperol Spritz, Caipirinha, Mojito, Margarita, Espresso Martini and Alpine Berry Smash. These are examples; the final selection will be adapted to your preferences and the atmosphere of the event.</p>
          </div>
          <div className="pricing-record-section">
            <h4 className="detail-kicker">Extension of service</h4>
            <p className="pricing-record-copy">A further two-hour block can be added during the same event at a 20% discount as a same-event extension.</p>
          </div>
        </div>
      </details>
    </div>
  </section>;
}
