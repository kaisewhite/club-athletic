import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowText } from "./arrow-text";

export type FaqTableRow = {
  question: string;
  answer: ReactNode;
  to?: string;
  section?: string;
};

export function FaqTable({ rows, note, label }: { rows: FaqTableRow[]; note?: string; label: string }) {
  return <div className="detail-table-wrap faq-table-wrap">
    <table className="detail-table faq-table" aria-label={label}>
      <thead><tr><th scope="col">Question</th><th scope="col">Answer</th></tr></thead>
      {rows.map((row, index) => <Fragment key={row.question}>
        {row.section && row.section !== rows[index - 1]?.section && <tbody className="faq-table-section"><tr><th scope="rowgroup" colSpan={2}>{row.section}</th></tr></tbody>}
        <tbody><tr className="faq-table-row">
          <th scope="row">{row.to ? <Link className="faq-question-link" to={row.to}><ArrowText>{row.question}</ArrowText><span aria-hidden="true"><ArrowUpRight size="1em" /></span></Link> : <ArrowText>{row.question}</ArrowText>}</th>
          <td data-label="Answer">{typeof row.answer === "string" ? <ArrowText>{row.answer}</ArrowText> : row.answer}</td>
        </tr></tbody>
      </Fragment>)}
      {note && <tbody className="faq-table-note"><tr><td colSpan={2}><ArrowText>{note}</ArrowText></td></tr></tbody>}
    </table>
  </div>;
}

export const roomSharingFaqEntries: FaqTableRow[] = [
  {
    question: "Will I be sharing a room?",
    answer: "The remaining rooms are shared bunk rooms. Some rooms and bathrooms are shared on this trip. Your room would have up to 3 other people, not 6.",
  },
  {
    question: "What about bathrooms?",
    answer: "The chalet has 8 bathrooms or shower rooms, plus additional WCs. The other bedrooms have their own en-suites.",
  },
  {
    question: "Where can I keep my things?",
    answer: "The chalet has plenty of storage and a separate luggage area. Skis and boots can go in the on-site ski shop or storage area instead of your bedroom. The fitness room is down the hall and mostly empty, so you can also use it for extra luggage, clothes, or getting ready.",
  },
  {
    question: "How much time will I actually spend in my room?",
    answer: "You’re barely in your room during the day. Most people are out skiing, at après, in the hot tub or saunas, or in the common areas.",
  },
];

export const roomSharingFaqNote = "If sharing a room is not right for you, you are not locked in. Check other chalet options if you find a better fit.";

export function RoomSharingFaq() {
  return <section className="mt-8" aria-labelledby="room-sharing-faq-heading">
    <h3 id="room-sharing-faq-heading" className="mb-3 text-xl font-bold tracking-tight">Room Sharing, Bathrooms &amp; Storage</h3>
    <FaqTable rows={roomSharingFaqEntries} note={roomSharingFaqNote} label="Room sharing questions and answers" />
  </section>;
}
