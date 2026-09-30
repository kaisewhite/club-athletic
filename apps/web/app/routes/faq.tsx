import { Link } from "react-router";
import { getTripOverview } from "@/lib/db/repository.server";
import { faqTiles } from "../lib/faq-content.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/faq";

export async function loader() {
  return { tiles: faqTiles(await getTripOverview()) };
}

export default function FAQ({ loaderData: data }: Route.ComponentProps) {
  return <section aria-labelledby="faq-heading">
    <PageHeading id="faq-heading" sub="Quick answers to the questions we hear most.">Frequently asked</PageHeading>
    <div className="overview-tiles faq-tiles">
      {data.tiles.map((tile) => <Link className="overview-tile" to={tile.to} key={tile.kicker} aria-label={tile.question}>
        <div className="tile-question">{tile.question}</div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        <div className="tile-answer">
          {tile.lead && <span className={`tile-lead${tile.accent ? " text-accent" : ""}`}>{tile.lead}</span>}
          {tile.sub && <span className="tile-sub">{tile.sub}</span>}
        </div>
      </Link>)}
    </div>
  </section>;
}
