import { useEffect, useRef } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { createTextLimiter } from "../../src/lib/chat/rate-limit.server";
import { saveFolieDouceVote } from "../../src/lib/db/folie-douce-votes.server";
import { getFolieDouceVotes } from "../../src/lib/db/repository.server";
import { folieDouceVoteSchema } from "../../src/lib/folie-douce-vote-schema";
import { PageHeading } from "../components/trip-details";
import { tripPageMeta } from "../lib/social-meta";
import type { Route } from "./+types/folie-douce";
import "../components/folie-douce.css";

const writeLimiter = createTextLimiter();
const MAX_FORM_BYTES = 4_096;

function rateLimitKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return `folie-douce-vote:${forwarded || "direct"}`;
}

export function meta() {
  return tripPageMeta({ path: "/folie-douce", title: "La Folie Douce · Méribel ’27 — Club Athletic", description: "Vote for a VIP table or general admission at La Folie Douce. See the group’s choices and read how VIP tables work." });
}

export async function loader() {
  return getFolieDouceVotes();
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return { ok: false, message: "This form accepts votes only." };
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return { ok: false, message: "Request origin is not allowed." };
    } catch {
      return { ok: false, message: "Request origin is not allowed." };
    }
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return { ok: false, message: "Form submission is too large." };
  const retryAfter = writeLimiter.take(rateLimitKey(request));
  if (retryAfter > 0) return { ok: false, message: "Too many submissions. Try again shortly." };

  let form: FormData;
  try { form = await request.formData(); }
  catch { return { ok: false, message: "The form submission could not be read." }; }
  // Quietly discard automated submissions caught by the off-screen honeypot.
  if (String(form.get("website") ?? "").trim()) return { ok: true, message: "Your choice has been saved." };
  const parsed = folieDouceVoteSchema.safeParse({
    firstName: form.get("firstName"), lastName: form.get("lastName"), choice: form.get("choice"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check your name and choice." };

  try {
    await saveFolieDouceVote(parsed.data);
    return { ok: true, message: "Thanks — your choice is saved. Submit again with the same name if you need to change it." };
  } catch (error) {
    console.error("La Folie Douce vote failed.", error instanceof Error ? error.name : "Unknown error");
    return { ok: false, message: "We couldn’t save your choice. Try again in a moment." };
  }
}

type Vote = Awaited<ReturnType<typeof loader>>["vip"][number];

function VoteGroup({ title, votes }: { title: string; votes: Vote[] }) {
  return <section className="folie-vote-group" aria-label={title}>
    <div className="folie-vote-group-heading"><h3>{title}</h3><span>{votes.length} {votes.length === 1 ? "vote" : "votes"}</span></div>
    {votes.length ? <ul>{votes.map((vote) => <li key={vote.id}>{[vote.firstName, vote.lastName].filter(Boolean).join(" ")}</li>)}</ul> : <p>No responses yet.</p>}
  </section>;
}

export default function FolieDouce({ loaderData: votes }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (actionData?.ok) formRef.current?.reset(); }, [actionData]);
  const saving = navigation.state === "submitting";

  return <section className="folie-page" aria-labelledby="folie-heading">
    <PageHeading id="folie-heading" sub="Choose your plan for an all-day table at La Folie Douce.">La Folie Douce</PageHeading>

    <section className="folie-guide" aria-labelledby="folie-guide-heading">
      <h3 id="folie-guide-heading">A full day from the same table</h3>
      <div className="folie-facts">
        <p><strong>Booking:</strong> There’s no minimum spend, but reserving a table requires a minimum drink quantity. One example is about 6 L of wine or champagne for 11 people.</p>
        <p><strong>Standard or Premium:</strong> Standard tables sit farther from the stage and DJs, with no premium bottle requirement. Premium tables are closer and require higher-end wine or champagne selections.</p>
        <p><strong>From noon:</strong> Your table is yours for the whole day, and food is served directly at the table.</p>
        <p><strong>Shows and après:</strong> Live performers start around 12:30 PM; DJ and clubbing pick up around 3 PM.</p>
        <p><strong>Special delivery:</strong> Some premium bottles can arrive by zip line with smoke and pyrotechnic effects.</p>
      </div>
    </section>

    <section className="folie-questionnaire" aria-labelledby="folie-vote-heading">
      <div className="folie-section-heading"><div><h3 id="folie-vote-heading">Which option are you choosing?</h3><p>Enter your name so we can keep one current response per person.</p></div></div>
      <Form method="post" className="folie-vote-form" ref={formRef}>
        <label className="folie-field">First name<input name="firstName" autoComplete="given-name" maxLength={80} required /></label>
        <label className="folie-field"><span>Last name <small>(if applicable)</small></span><input name="lastName" autoComplete="family-name" maxLength={80} /></label>
        <fieldset className="folie-choice-fieldset">
          <legend>Your plan</legend>
          <label className="folie-choice"><input type="radio" name="choice" value="VIP_TABLE" required /><span><strong>VIP table</strong><small>About $200 per person, estimated</small></span></label>
          <label className="folie-choice"><input type="radio" name="choice" value="GENERAL_ADMISSION" /><span><strong>General Admission</strong><small>Free</small></span></label>
        </fieldset>
        <label className="folie-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        <div className="folie-form-submit"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save my choice"}</button>{actionData && <p role={actionData.ok ? "status" : "alert"} data-ok={actionData.ok}>{actionData.message}</p>}</div>
      </Form>
    </section>

    <section className="folie-results" aria-labelledby="folie-results-heading">
      <div className="folie-section-heading"><div><h3 id="folie-results-heading">Current responses</h3><p>Names are listed under the option they chose.</p></div></div>
      <div className="folie-vote-groups">
        <VoteGroup title="VIP table" votes={votes.vip} />
        <VoteGroup title="General Admission" votes={votes.generalAdmission} />
      </div>
    </section>
  </section>;
}
