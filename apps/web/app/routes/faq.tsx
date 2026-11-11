import { getTripOverview } from "@/lib/db/repository.server";
import { faqTiles } from "../lib/faq-content.server";
import { PageHeading } from "../components/trip-details";
import { FaqTable, roomSharingFaqEntries, roomSharingFaqNote } from "../components/room-sharing-faq";
import { ArrowText } from "../components/arrow-text";
import type { Route } from "./+types/faq";
import { tripPageMeta } from "../lib/social-meta";

export function meta() {
  return tripPageMeta({ path: "/faq", title: "FAQ · Méribel ’27 — Club Athletic", description: "Answers about the Méribel trip, chalet, room sharing, and group plans." });
}

export async function loader() {
  return { tiles: faqTiles(await getTripOverview()) };
}

export default function FAQ({ loaderData: data }: Route.ComponentProps) {
  const tripRows = data.tiles.map((tile) => ({
    section: "Trip",
    question: tile.question,
    to: tile.to,
    answer: <>
      {tile.lead && <strong className={`faq-answer-lead${tile.accent ? " text-accent" : ""}`}><ArrowText>{tile.lead}</ArrowText></strong>}
      {tile.sub && <span className="faq-answer-copy"><ArrowText>{tile.sub}</ArrowText></span>}
    </>,
  }));
  const roomRows = roomSharingFaqEntries.map((row, index) => index === 0
    ? { ...row, section: "Room Sharing, Bathrooms & Storage" }
    : row);
  return <section className="faq-chapter" aria-labelledby="faq-heading">
    <PageHeading id="faq-heading" sub="Quick answers to common questions.">FAQ</PageHeading>
    <div className="faq-table-intro"><span>01</span><p>Trip and room-sharing questions</p></div>
    <FaqTable rows={[...tripRows, ...roomRows]} note={roomSharingFaqNote} label="Trip and room-sharing questions and answers" />
  </section>;
}
