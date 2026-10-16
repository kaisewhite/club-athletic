const questions = [
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
] as const;

const closingNote = "If sharing a room is not right for you, you are not locked in. Check other chalet options if you find a better fit.";

export function RoomSharingFaq() {
  return <section className="mt-8" aria-labelledby="room-sharing-faq-heading">
    <h3 id="room-sharing-faq-heading" className="mb-3 text-xl font-bold tracking-tight">Room Sharing, Bathrooms &amp; Storage</h3>
    <div className="grid gap-3 md:grid-cols-2">
      {questions.map(({ question, answer }) => <article className="detail-card" key={question}>
        <h4 className="mb-2 text-base font-semibold">{question}</h4>
        <p className="m-0 text-sm leading-6 text-[var(--text-muted)]">{answer}</p>
      </article>)}
    </div>
    <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">{closingNote}</p>
  </section>;
}
