import { getTripOverview } from "@/lib/db/repository.server";
import { faqTiles } from "../lib/faq-content.server";
import { PageHeading } from "../components/trip-details";
import { FaqTable, roomSharingFaqEntries, roomSharingFaqNote } from "../components/room-sharing-faq";
import type { Route } from "./+types/faq";

export async function loader() {
  return { tiles: faqTiles(await getTripOverview()) };
}

export default function FAQ({ loaderData: data }: Route.ComponentProps) {
  const tripRows = data.tiles.map((tile) => ({
    section: "Trip",
    question: tile.question,
    to: tile.to,
    answer: <>
      {tile.lead && <strong className={`faq-answer-lead${tile.accent ? " text-accent" : ""}`}>{tile.lead}</strong>}
      {tile.sub && <span className="faq-answer-copy">{tile.sub}</span>}
    </>,
  }));
  const roomRows = roomSharingFaqEntries.map((row, index) => index === 0
    ? { ...row, section: "Room Sharing, Bathrooms & Storage" }
    : row);
  return <section aria-labelledby="faq-heading">
    <PageHeading id="faq-heading" sub="Quick answers to common questions.">FAQ</PageHeading>
    <FaqTable rows={[...tripRows, ...roomRows]} note={roomSharingFaqNote} label="Trip and room-sharing questions and answers" />
  </section>;
}
