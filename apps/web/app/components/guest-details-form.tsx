import { useEffect, useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useRevalidator } from "react-router";
import { guestDetailsSchema } from "../../src/lib/guest-details-schema";
import { formatRoomType } from "../lib/room-types";
import { GuestInstagramLink } from "./guest-instagram-link";
import "./guest-details.css";

type GuestDetailsValues = {
  firstName: string;
  lastName: string;
  phone: string;
  venmoHandle: string;
  instagramHandle: string;
  dietaryNotes: string;
  favoriteCocktails: string;
  roomId: string;
};
type FieldName = keyof GuestDetailsValues;
type RoomOption = { id: string; name: string; shortName: string; type: string; floorName: string; openCount: number; occupants: { displayName: string; instagramUrl: string | null }[]; priceLabel: string | null; totalPriceLabel: string | null; description: string | null };
type ResponseBody = { ok: boolean; code?: string; error?: string; fieldErrors?: Partial<Record<FieldName, string>>; created?: boolean };

function isResponseBody(value: unknown): value is ResponseBody {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

const fieldSchemas = guestDetailsSchema.shape;
const fieldNamesByStep: Record<number, FieldName[]> = {
  1: ["firstName", "lastName"], 2: ["roomId"], 3: ["phone"],
  4: ["venmoHandle", "instagramHandle"], 5: ["dietaryNotes"], 6: ["favoriteCocktails"],
};
const stepNames = ["Your name", "Select a room", "Mobile / WhatsApp number", "Venmo & Instagram", "Dietary restrictions", "Cocktail favorites", "Payment & cancellation policy", "Trip details & group chat"];

function errorText(error: unknown) {
  return fieldErrors(error).join(" ");
}

function fieldErrors(error: unknown) {
  return Array.isArray(error) ? error.filter(Boolean).map(String) : error ? [String(error)] : [];
}

function validateField<Name extends FieldName>(name: Name, value: string) {
  const result = fieldSchemas[name].safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message ?? "Check this answer.";
}

export function GuestDetailsForm({ rooms }: { rooms: RoomOption[] }) {
  const revalidator = useRevalidator();
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [finished, setFinished] = useState(false);
  const submissionId = useRef<string | null>(null);
  const timers = useRef(new Map<FieldName, ReturnType<typeof setTimeout>>());
  const latestValues = useRef(new Map<FieldName, string>());
  const requests = useRef(new Map<FieldName, Promise<boolean>>());
  const saveQueue = useRef(Promise.resolve());
  const honeypot = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = "club-athletic-guest-details-submission";
    try {
      const stored = sessionStorage.getItem(key);
      submissionId.current = stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : crypto.randomUUID();
      sessionStorage.setItem(key, submissionId.current);
    } catch { submissionId.current = crypto.randomUUID(); }
    return () => { for (const timer of timers.current.values()) clearTimeout(timer); };
  }, []);

  const persistField = (name: FieldName): Promise<boolean> => {
    const value = latestValues.current.get(name);
    if (value === undefined) return Promise.resolve(true);
    const active = requests.current.get(name);
    if (active) return active.then(() => latestValues.current.get(name) === value ? true : persistField(name));
    const request = saveQueue.current.then(() => fetch("/api/guest-details", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "field", submissionId: submissionId.current, field: name, value }) }))
      .then(async (response) => { const payload: unknown = await response.json().catch(() => null); return response.ok && isResponseBody(payload) && payload.ok; })
      .catch(() => false)
      .then((ok) => {
        if (requests.current.get(name) === request) requests.current.delete(name);
        if (ok && latestValues.current.get(name) === value) latestValues.current.delete(name);
        setSaveState(ok ? (latestValues.current.size ? "saving" : "saved") : "error");
        return ok;
      });
    saveQueue.current = request.then(() => undefined, () => undefined);
    requests.current.set(name, request);
    return request;
  };
  const scheduleAutosave = (name: FieldName, value: string, immediate = false) => {
    latestValues.current.set(name, value);
    const old = timers.current.get(name);
    if (old) clearTimeout(old);
    setSaveState("saving");
    if (immediate) { void persistField(name); return; }
    timers.current.set(name, setTimeout(() => { timers.current.delete(name); void persistField(name); }, 500));
  };
  const flushFields = async (fields: FieldName[]) => {
    for (const name of fields) {
      const timer = timers.current.get(name);
      if (timer) { clearTimeout(timer); timers.current.delete(name); }
    }
    const results = await Promise.all(fields.map((name) => persistField(name)));
    return results.every(Boolean);
  };
  const form = useForm({
    defaultValues: {
      firstName: "", lastName: "", phone: "", venmoHandle: "", instagramHandle: "", dietaryNotes: "", favoriteCocktails: "", roomId: "",
    } satisfies GuestDetailsValues,
    onSubmit: async ({ value }) => {
      setBusy(true);
      setFormError("");
      try {
        submissionId.current ??= crypto.randomUUID();
        const response = await fetch("/api/guest-details", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...value, submissionId: submissionId.current, website: honeypot.current?.value ?? "" }),
        });
        let payload: unknown;
        try { payload = await response.json(); }
        catch {
          setFormError("The server could not confirm your submission. Your answers are still here; please try again.");
          return;
        }
        if (!isResponseBody(payload)) {
          setFormError("The server could not confirm your submission. Your answers are still here; please try again.");
          return;
        }
        const result = payload;
        if (!response.ok || !result.ok) {
          if (response.status === 409 && result.code === "ROOM_FULL") {
            setStep(2);
            await revalidator.revalidate();
          }
          if (result.fieldErrors) {
            const firstError = Object.entries(result.fieldErrors).find(([, message]) => message);
            const target = firstError?.[0] as FieldName | undefined;
            if (target) setStep(Object.entries(fieldNamesByStep).find(([, fields]) => fields.includes(target))?.[0] ? Number(Object.entries(fieldNamesByStep).find(([, fields]) => fields.includes(target))![0]) : 1);
          }
          setFormError(result.error ?? "We couldn’t save your details. Try again.");
          return;
        }
        setFinished(true);
        setStep(9);
        try { sessionStorage.removeItem("club-athletic-guest-details-submission"); } catch { /* storage may be unavailable */ }
      } catch {
        setFormError("We couldn’t reach the server. Your answers are still here; check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
  });
  const selectedRoomId = useStore(form.store, (state) => state.values.roomId);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId);

  const continueStep = async () => {
    const fields = fieldNamesByStep[step];
    if (fields) {
      await Promise.all(fields.map((name) => form.validateField(name, "blur")));
      const invalid = fields.find((name) => (form.getFieldMeta(name)?.errors.length ?? 0) > 0);
      if (invalid) {
        if (invalid === "roomId") document.querySelector<HTMLInputElement>('input[name="roomId"]')?.focus();
        else document.getElementById(`guest-${invalid}`)?.focus();
        return;
      }
      if (!await flushFields(fields)) {
        setFormError("This answer has not reached the database yet. Check your connection and try again.");
        return;
      }
    }
    setFormError("");
    setStep((current) => current + 1);
  };

  const back = () => { setFormError(""); setStep((current) => Math.max(0, current - 1)); };
  const clearAfterEdit = () => { setFormError(""); };
  const onFieldEdit = (name: FieldName, value: string) => { clearAfterEdit(); scheduleAutosave(name, value); };
  const onFieldBlur = (name: FieldName, value: string) => { scheduleAutosave(name, value, true); };
  const onNextKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void continueStep(); }
  };
  const progress = step > 0 && step < 9 ? Math.round((step / 8) * 100) : 100;

  return <div className="guest-details-flow">
    {step === 0 && <section className="guest-details-card" aria-labelledby="guest-form-welcome">
      <p className="guest-details-eyebrow">Méribel 2027 · Guest questionnaire</p>
      <h2 id="guest-form-welcome">Méribel 2027 — Guest Questionnaire</h2>
      <p className="guest-details-copy">Please answer these questions so we can confirm your room choice, plan meals, and coordinate the trip.</p>
      <button type="button" className="guest-details-primary" onClick={() => setStep(1)}>Start</button>
    </section>}

    {step > 0 && step < 9 && <form className="guest-details-card" noValidate onSubmit={(event) => { event.preventDefault(); if (step === 8) void form.handleSubmit(); else void continueStep(); }}>
      <div className="guest-details-progress" aria-label={step <= 6 ? `Question ${step} of 6` : `Step ${step} of 8`}>
        <span className="guest-details-progress-label">{step <= 6 ? `Question ${step} of 6` : `Step ${step} of 8`}</span>
        <div className="guest-details-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={stepNames[step - 1]}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      {step === 1 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Your name</h2>
        <p className="guest-details-copy">Enter your first name and, if you use one, your last name.</p>
        <div className="guest-details-name-fields">
          <form.Field name="firstName" validators={{ onBlur: ({ value }) => validateField("firstName", value) }}>{(field) => <FieldInput field={field} id="guest-firstName" label="First name" autoComplete="given-name" onEdit={(value) => onFieldEdit("firstName", value)} onBlur={(value) => onFieldBlur("firstName", value)} />}</form.Field>
          <form.Field name="lastName" validators={{ onBlur: ({ value }) => validateField("lastName", value) }}>{(field) => <FieldInput field={field} id="guest-lastName" label="Last name (optional)" autoComplete="family-name" onEdit={(value) => onFieldEdit("lastName", value)} onBlur={(value) => onFieldBlur("lastName", value)} />}</form.Field>
        </div>
      </section>}

      {step === 2 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Select a room</h2>
        <p className="guest-details-copy">Choose a room with an open spot. You can see who is already assigned.</p>
        <form.Field name="roomId" validators={{ onChange: ({ value }) => validateField("roomId", value), onBlur: ({ value }) => validateField("roomId", value) }}>{(field) => <fieldset className="guest-room-options" aria-describedby={field.state.meta.errors.length ? "guest-room-error" : undefined}>
          <legend className="guest-room-legend">Available rooms</legend>
          {rooms.filter((room) => room.openCount > 0).map((room) => <div className="guest-room-option" key={room.id}>
            <label className="guest-room-option-choice">
              <input type="radio" name={field.name} value={room.id} checked={field.state.value === room.id} onChange={() => { clearAfterEdit(); field.handleChange(room.id); scheduleAutosave("roomId", room.id); }} />
              <span className="guest-room-option-content">
                <span className="guest-room-option-heading"><strong>{room.name}</strong><span>{formatRoomType(room.type)}</span></span>
                <span>{room.floorName}{room.priceLabel ? ` · Room rate ${room.priceLabel} per person` : ""}</span>
                <strong className="guest-room-total">{room.totalPriceLabel ? `Total per person · ${room.totalPriceLabel} all-in` : "Total per person · Price pending"}</strong>
                {room.description && <span>{room.description}</span>}
                <span className="guest-room-open">{room.openCount} open {room.openCount === 1 ? "spot" : "spots"}</span>
              </span>
            </label>
            <div className="guest-room-occupants">
              <span>Currently assigned</span>
              {room.occupants.length
                ? <ul>{room.occupants.map((guest) => <li key={guest.displayName}><GuestInstagramLink displayName={guest.displayName} instagramUrl={guest.instagramUrl} /></li>)}</ul>
                : <span className="guest-room-empty">No one yet</span>}
            </div>
          </div>)}
          {field.state.meta.errors.length > 0 && <span className="guest-details-field-error" id="guest-room-error">{errorText(field.state.meta.errors)}</span>}
        </fieldset>}</form.Field>
      </section>}

      {step === 3 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Mobile / WhatsApp number</h2>
        <p className="guest-details-copy">Use +country code for international numbers. US numbers use the default country code.</p>
        <form.Field name="phone" validators={{ onBlur: ({ value }) => validateField("phone", value) }}>{(field) => <FieldInput field={field} id="guest-phone" label="Mobile / WhatsApp number" type="tel" autoComplete="tel" placeholder="(555) 555-5555" onEdit={(value) => onFieldEdit("phone", value)} onBlur={(value) => onFieldBlur("phone", value)} />}</form.Field>
      </section>}

      {step === 4 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Venmo &amp; Instagram</h2>
        <p className="guest-details-copy">Add your payment and social handles.</p>
        <div className="guest-details-name-fields">
          <form.Field name="venmoHandle" validators={{ onBlur: ({ value }) => validateField("venmoHandle", value) }}>{(field) => <FieldInput field={field} id="guest-venmoHandle" label="Venmo handle" description="Include the @ if you use one." autoComplete="off" onEdit={(value) => onFieldEdit("venmoHandle", value)} onBlur={(value) => onFieldBlur("venmoHandle", value)} />}</form.Field>
          <form.Field name="instagramHandle" validators={{ onBlur: ({ value }) => validateField("instagramHandle", value) }}>{(field) => <FieldInput field={field} id="guest-instagramHandle" label="Instagram handle (optional)" description="Include the @ if you use one." autoComplete="off" onEdit={(value) => onFieldEdit("instagramHandle", value)} onBlur={(value) => onFieldBlur("instagramHandle", value)} />}</form.Field>
        </div>
      </section>}

      {step === 5 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Any food allergies or dietary restrictions?</h2>
        <p className="guest-details-copy">Please include allergies, dietary restrictions, or anything the chef should know. If none, write “None.”</p>
        <form.Field name="dietaryNotes" validators={{ onBlur: ({ value }) => validateField("dietaryNotes", value) }}>{(field) => <FieldTextArea field={field} id="guest-dietaryNotes" label="Dietary restrictions" maxLength={500} onEdit={(value) => onFieldEdit("dietaryNotes", value)} onBlur={(value) => onFieldBlur("dietaryNotes", value)} onKeyDown={onNextKey} />}</form.Field>
      </section>}

      {step === 6 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">What are your favorite cocktails?</h2>
        <p className="guest-details-copy">List a few favorites so we can plan drinks for the chalet. Examples: Espresso Martini, Hugo Spritz, Negroni, Margarita, Aperol Spritz, Old Fashioned, Gin Gimlet, French 75—or anything else.</p>
        <form.Field name="favoriteCocktails" validators={{ onBlur: ({ value }) => validateField("favoriteCocktails", value) }}>{(field) => <FieldTextArea field={field} id="guest-favoriteCocktails" label="Favorite cocktails" maxLength={300} onEdit={(value) => onFieldEdit("favoriteCocktails", value)} onBlur={(value) => onFieldBlur("favoriteCocktails", value)} onKeyDown={onNextKey} />}</form.Field>
      </section>}

      {step === 7 && <section aria-labelledby="guest-question-title" className="guest-details-statement">
        <p className="guest-details-eyebrow">Step 7</p>
        <h2 id="guest-question-title">Payment &amp; cancellation policy</h2>
        <p>{selectedRoom?.totalPriceLabel
          ? `Your total for ${selectedRoom.name} is ${selectedRoom.totalPriceLabel} per person, all-in.`
          : "Your per-person room total is shown with each room choice."}</p>
        <p>The all-in total includes your room, taxes, shuttle, incidentals, and chef. Flights, ski pass, and equipment rental are separate.</p>
        <p>Payment is due in full — there is no deposit. Please Venmo your payment to <strong>@kaise-white</strong> using <a href="https://venmo.com/u/kaise-white" target="_blank" rel="noopener noreferrer">my Venmo profile</a>.</p>
        <p>You may drop out through November 15 for a full refund. After November 15, if you can no longer attend, you’ll need to find your own replacement to take over your spot/payment.</p>
      </section>}

      {step === 8 && <section aria-labelledby="guest-question-title" className="guest-details-statement">
        <p className="guest-details-eyebrow">Step 8</p>
        <h2 id="guest-question-title">Trip details &amp; group chat</h2>
        <p>Everything you need for the trip — including flight guidance, shuttle timing, chalet details, and FAQs — is here:</p>
        <p><a href="https://meribel.clubathletic.org/" target="_blank" rel="noopener noreferrer">https://meribel.clubathletic.org/</a></p>
        <p>Join the WhatsApp group here:</p>
        <p><a href="https://chat.whatsapp.com/GxiADd9xPDg9f5OWOly7g7?s=cl&amp;p=i&amp;mlu=4&amp;ilr=4&amp;iam=0" target="_blank" rel="noopener noreferrer">Open the Méribel WhatsApp group</a></p>
        <label className="guest-details-honeypot" aria-hidden="true">Website<input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" /></label>
      </section>}

      {formError && <p className="guest-details-error" role="alert">{formError}</p>}
      <p className="guest-details-save-status" role="status" aria-live="polite">{saveState === "saving" ? "Saving your answers…" : saveState === "saved" ? "Answers saved" : saveState === "error" ? "Could not save. Continue to retry." : ""}</p>
      <div className="guest-details-actions">
        <button type="button" className="guest-details-back" onClick={back} disabled={busy}>Back</button>
        {step < 8 ? <button key="continue" type="button" className="guest-details-primary" onClick={() => void continueStep()}>Continue</button>
          : <button key="finish" type="submit" className="guest-details-primary" disabled={busy}>{busy ? "Sending…" : "Finish"}</button>}
      </div>
    </form>}

    {finished && <section className="guest-details-card guest-details-thanks" aria-labelledby="guest-thanks-title" role="status">
      <p className="guest-details-eyebrow">Méribel 2027</p>
      <h2 id="guest-thanks-title">Thanks — you’re all set.</h2>
      <p className="guest-details-copy">Your questionnaire has been submitted.</p>
      <a className="guest-details-primary guest-details-link-button" href="https://meribel.clubathletic.org/">View trip details</a>
    </section>}
  </div>;
}

function FieldInput({ field, id, label, description, type = "text", autoComplete, placeholder, onEdit, onBlur }: {
  field: { name: FieldName; state: { value: string; meta: { errors: unknown[] } }; handleBlur: () => void; handleChange: (value: string) => void };
  id: string; label: string; description?: string; type?: string; autoComplete: string; placeholder?: string; onEdit: (value: string) => void; onBlur: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const errors = fieldErrors(field.state.meta.errors);
  const describedBy = [description ? descriptionId : null, errors.length ? errorId : null].filter(Boolean).join(" ") || undefined;
  return <label className="guest-details-label" htmlFor={id}>
    <span>{label}</span>
    {description && <span className="guest-details-hint" id={descriptionId}>{description}</span>}
    <input id={id} name={field.name} type={type} autoComplete={autoComplete} placeholder={placeholder} value={field.state.value} maxLength={field.name === "firstName" || field.name === "lastName" ? 80 : 100} onChange={(event) => { field.handleChange(event.target.value); onEdit(event.target.value); }} onBlur={() => { field.handleBlur(); onBlur(field.state.value); }} aria-invalid={errors.length > 0} aria-describedby={describedBy} />
    {errors.length > 0 && <span className="guest-details-field-error" id={errorId}>{errorText(errors)}</span>}
  </label>;
}

function FieldTextArea({ field, id, label, maxLength, onEdit, onBlur, onKeyDown }: {
  field: { name: FieldName; state: { value: string; meta: { errors: unknown[] } }; handleBlur: () => void; handleChange: (value: string) => void };
  id: string; label: string; maxLength: number; onEdit: (value: string) => void; onBlur: (value: string) => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const errorId = `${id}-error`;
  const errors = fieldErrors(field.state.meta.errors);
  const remaining = maxLength - field.state.value.length;
  return <label className="guest-details-label" htmlFor={id}>
    <span>{label}</span>
    <textarea id={id} name={field.name} rows={4} maxLength={maxLength} value={field.state.value} onChange={(event) => { field.handleChange(event.target.value); onEdit(event.target.value); }} onBlur={() => { field.handleBlur(); onBlur(field.state.value); }} onKeyDown={onKeyDown} aria-invalid={errors.length > 0} aria-describedby={errors.length ? errorId : undefined} />
    <span className="guest-details-hint">{remaining} characters left. Press Enter to continue; Shift+Enter for a new line.</span>
    {errors.length > 0 && <span className="guest-details-field-error" id={errorId}>{errorText(errors)}</span>}
  </label>;
}
