import { redirect } from "react-router";

export function loader() {
  return redirect("/guest-questionnaire", 301);
}
