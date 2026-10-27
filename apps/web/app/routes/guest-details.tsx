import { GuestDetailsForm } from "../components/guest-details-form";

export function meta() {
  return [{ title: "Guest details · Méribel ’27 — Club Athletic" }];
}

export default function GuestDetails() {
  return <section aria-label="Méribel 2027 guest details">
    <GuestDetailsForm />
  </section>;
}
