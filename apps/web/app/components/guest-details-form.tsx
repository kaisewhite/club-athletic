import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { guestDetailsSchema } from "../../src/lib/guest-details-schema";
import "./guest-details.css";

type GuestDetailsValues = {
  firstName: string;
  lastName: string;
  phone: string;
  venmoHandle: string;
  instagramHandle: string;
  dietaryNotes: string;
  favoriteCocktails: string;
};
type FieldName = keyof GuestDetailsValues;
type ResponseBody = { ok: boolean; error?: string; fieldErrors?: Partial<Record<FieldName, string>>; created?: boolean };

const fieldSchemas = guestDetailsSchema.shape;
const fieldNamesByStep: Record<number, FieldName[]> = {
  1: ["firstName", "lastName"], 2: ["phone"], 3: ["venmoHandle", "instagramHandle"],
  4: ["dietaryNotes"], 5: ["favoriteCocktails"],
};
const stepNames = ["Your name", "Mobile / WhatsApp number", "Venmo & Instagram", "Dietary restrictions", "Cocktail favorites", "Payment & cancellation policy", "Trip details & group chat"];

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

export function GuestDetailsForm() {
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const submissionId = useRef<string | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const form = useForm({
    defaultValues: {
      firstName: "", lastName: "", phone: "", venmoHandle: "", instagramHandle: "", dietaryNotes: "", favoriteCocktails: "",
    } satisfies GuestDetailsValues,
    onSubmit: async ({ value }) => {
      setBusy(true);
      setFormError("");
      submissionId.current ??= crypto.randomUUID();
      try {
        const response = await fetch("/api/guest-details", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...value, submissionId: submissionId.current, website: honeypot.current?.value ?? "" }),
        });
        const result = await response.json() as ResponseBody;
        if (!response.ok || !result.ok) {
          if (result.fieldErrors) {
            const firstError = Object.entries(result.fieldErrors).find(([, message]) => message);
            const target = firstError?.[0] as FieldName | undefined;
            if (target) setStep(Object.entries(fieldNamesByStep).find(([, fields]) => fields.includes(target))?.[0] ? Number(Object.entries(fieldNamesByStep).find(([, fields]) => fields.includes(target))![0]) : 1);
          }
          setFormError(result.error ?? "We couldn’t save your details. Try again.");
          return;
        }
        setFinished(true);
        setStep(8);
      } catch {
        setFormError("We couldn’t reach the server. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
  });

  const continueStep = async () => {
    const fields = fieldNamesByStep[step];
    if (fields) {
      await Promise.all(fields.map((name) => form.validateField(name, "blur")));
      const invalid = fields.find((name) => (form.getFieldMeta(name)?.errors.length ?? 0) > 0);
      if (invalid) {
        document.getElementById(`guest-${invalid}`)?.focus();
        return;
      }
    }
    setFormError("");
    setStep((current) => current + 1);
  };

  const back = () => { setFormError(""); setStep((current) => Math.max(0, current - 1)); };
  const clearAfterEdit = () => { setFormError(""); if (formError) submissionId.current = null; };
  const onNextKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void continueStep(); }
  };
  const progress = step > 0 && step < 8 ? Math.round((step / 7) * 100) : 100;

  return <div className="guest-details-flow">
    {step === 0 && <section className="guest-details-card" aria-labelledby="guest-form-welcome">
      <p className="guest-details-eyebrow">Méribel 2027 · Guest details</p>
      <h2 id="guest-form-welcome">Méribel 2027 — Guest Details</h2>
      <p className="guest-details-copy">Quick guest info for chalet payments, chef planning, and trip communication. Takes about a minute.</p>
      <button type="button" className="guest-details-primary" onClick={() => setStep(1)}>Start</button>
    </section>}

    {step > 0 && step < 8 && <form className="guest-details-card" noValidate onSubmit={(event) => { event.preventDefault(); if (step === 7) void form.handleSubmit(); else void continueStep(); }}>
      <div className="guest-details-progress" aria-label={`Step ${step} of 7`}>
        <span className="guest-details-progress-label">{step <= 5 ? `Question ${step} of 5` : `Step ${step} of 7`}</span>
        <div className="guest-details-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={stepNames[step - 1]}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      {step === 1 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Your name</h2>
        <p className="guest-details-copy">Enter your first and last name.</p>
        <div className="guest-details-name-fields">
          <form.Field name="firstName" validators={{ onBlur: ({ value }) => validateField("firstName", value) }}>{(field) => <FieldInput field={field} id="guest-firstName" label="First name" autoComplete="given-name" onEdit={clearAfterEdit} />}</form.Field>
          <form.Field name="lastName" validators={{ onBlur: ({ value }) => validateField("lastName", value) }}>{(field) => <FieldInput field={field} id="guest-lastName" label="Last name" autoComplete="family-name" onEdit={clearAfterEdit} />}</form.Field>
        </div>
      </section>}

      {step === 2 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Mobile / WhatsApp number</h2>
        <p className="guest-details-copy">Use +country code for international numbers. US numbers use the default country code.</p>
        <form.Field name="phone" validators={{ onBlur: ({ value }) => validateField("phone", value) }}>{(field) => <FieldInput field={field} id="guest-phone" label="Mobile / WhatsApp number" type="tel" autoComplete="tel" placeholder="(555) 555-5555" onEdit={clearAfterEdit} />}</form.Field>
      </section>}

      {step === 3 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Venmo &amp; Instagram</h2>
        <p className="guest-details-copy">Add your payment and social handles.</p>
        <div className="guest-details-name-fields">
          <form.Field name="venmoHandle" validators={{ onBlur: ({ value }) => validateField("venmoHandle", value) }}>{(field) => <FieldInput field={field} id="guest-venmoHandle" label="Venmo handle" description="Include the @ if you use one." autoComplete="off" onEdit={clearAfterEdit} />}</form.Field>
          <form.Field name="instagramHandle" validators={{ onBlur: ({ value }) => validateField("instagramHandle", value) }}>{(field) => <FieldInput field={field} id="guest-instagramHandle" label="Instagram handle (optional)" description="Include the @ if you use one." autoComplete="off" onEdit={clearAfterEdit} />}</form.Field>
        </div>
      </section>}

      {step === 4 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">Any food allergies or dietary restrictions?</h2>
        <p className="guest-details-copy">Please include allergies, dietary restrictions, or anything the chef should know. If none, write “None.”</p>
        <form.Field name="dietaryNotes" validators={{ onBlur: ({ value }) => validateField("dietaryNotes", value) }}>{(field) => <FieldTextArea field={field} id="guest-dietaryNotes" label="Dietary restrictions" maxLength={500} onEdit={clearAfterEdit} onKeyDown={onNextKey} />}</form.Field>
      </section>}

      {step === 5 && <section aria-labelledby="guest-question-title">
        <h2 id="guest-question-title">What are your favorite cocktails?</h2>
        <p className="guest-details-copy">List a few favorites so we can plan drinks for the chalet. Examples: Espresso Martini, Hugo Spritz, Negroni, Margarita, Aperol Spritz, Old Fashioned, Gin Gimlet, French 75—or anything else.</p>
        <form.Field name="favoriteCocktails" validators={{ onBlur: ({ value }) => validateField("favoriteCocktails", value) }}>{(field) => <FieldTextArea field={field} id="guest-favoriteCocktails" label="Favorite cocktails" maxLength={300} onEdit={clearAfterEdit} onKeyDown={onNextKey} />}</form.Field>
      </section>}

      {step === 6 && <section aria-labelledby="guest-question-title" className="guest-details-statement">
        <p className="guest-details-eyebrow">Question 6</p>
        <h2 id="guest-question-title">Payment &amp; cancellation policy</h2>
        <p>Payment is due in full — there is no deposit. You may drop out through November 15 for a full refund. After November 15, if you can no longer attend, you’ll need to find your own replacement to take over your spot/payment.</p>
      </section>}

      {step === 7 && <section aria-labelledby="guest-question-title" className="guest-details-statement">
        <p className="guest-details-eyebrow">Question 7</p>
        <h2 id="guest-question-title">Trip details &amp; group chat</h2>
        <p>Everything you need for the trip — including flight guidance, shuttle timing, chalet details, and FAQs — is here:</p>
        <p><a href="https://meribel.clubathletic.org/" target="_blank" rel="noopener noreferrer">https://meribel.clubathletic.org/</a></p>
        <p>Join the WhatsApp group here:</p>
        <p><a href="https://chat.whatsapp.com/GxiADd9xPDg9f5OWOly7g7?s=cl&amp;p=i&amp;mlu=4&amp;ilr=4&amp;iam=0" target="_blank" rel="noopener noreferrer">Open the Méribel WhatsApp group</a></p>
        <label className="guest-details-honeypot" aria-hidden="true">Website<input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" /></label>
      </section>}

      {formError && <p className="guest-details-error" role="alert">{formError}</p>}
      <div className="guest-details-actions">
        <button type="button" className="guest-details-back" onClick={back} disabled={busy}>Back</button>
        {step < 7 ? <button key="continue" type="button" className="guest-details-primary" onClick={() => void continueStep()}>Continue</button>
          : <button key="finish" type="submit" className="guest-details-primary" disabled={busy}>{busy ? "Sending…" : "Finish"}</button>}
      </div>
    </form>}

    {finished && <section className="guest-details-card guest-details-thanks" aria-labelledby="guest-thanks-title" role="status">
      <p className="guest-details-eyebrow">Méribel 2027</p>
      <h2 id="guest-thanks-title">Thanks — you’re all set.</h2>
      <p className="guest-details-copy">Your guest details have been submitted.</p>
      <a className="guest-details-primary guest-details-link-button" href="https://meribel.clubathletic.org/">View trip details</a>
    </section>}
  </div>;
}

function FieldInput({ field, id, label, description, type = "text", autoComplete, placeholder, onEdit }: {
  field: { name: FieldName; state: { value: string; meta: { errors: unknown[] } }; handleBlur: () => void; handleChange: (value: string) => void };
  id: string; label: string; description?: string; type?: string; autoComplete: string; placeholder?: string; onEdit: () => void;
}) {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const errors = fieldErrors(field.state.meta.errors);
  const describedBy = [description ? descriptionId : null, errors.length ? errorId : null].filter(Boolean).join(" ") || undefined;
  return <label className="guest-details-label" htmlFor={id}>
    <span>{label}</span>
    {description && <span className="guest-details-hint" id={descriptionId}>{description}</span>}
    <input id={id} name={field.name} type={type} autoComplete={autoComplete} placeholder={placeholder} value={field.state.value} maxLength={field.name === "firstName" || field.name === "lastName" ? 80 : 100} onBlur={field.handleBlur} onChange={(event) => { onEdit(); field.handleChange(event.target.value); }} aria-invalid={errors.length > 0} aria-describedby={describedBy} />
    {errors.length > 0 && <span className="guest-details-field-error" id={errorId}>{errorText(errors)}</span>}
  </label>;
}

function FieldTextArea({ field, id, label, maxLength, onEdit, onKeyDown }: {
  field: { name: FieldName; state: { value: string; meta: { errors: unknown[] } }; handleBlur: () => void; handleChange: (value: string) => void };
  id: string; label: string; maxLength: number; onEdit: () => void; onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const errorId = `${id}-error`;
  const errors = fieldErrors(field.state.meta.errors);
  const remaining = maxLength - field.state.value.length;
  return <label className="guest-details-label" htmlFor={id}>
    <span>{label}</span>
    <textarea id={id} name={field.name} rows={4} maxLength={maxLength} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => { onEdit(); field.handleChange(event.target.value); }} onKeyDown={onKeyDown} aria-invalid={errors.length > 0} aria-describedby={errors.length ? errorId : undefined} />
    <span className="guest-details-hint">{remaining} characters left. Press Enter to continue; Shift+Enter for a new line.</span>
    {errors.length > 0 && <span className="guest-details-field-error" id={errorId}>{errorText(errors)}</span>}
  </label>;
}
