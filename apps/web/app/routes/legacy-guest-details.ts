import { redirect } from "react-router";

export function loader() {
  return redirect("/questionnaire", 301);
}
