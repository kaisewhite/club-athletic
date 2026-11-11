import type { ReactNode } from "react";
import { ArrowText } from "./arrow-text";
import "./trip-details.css";

export function PageHeading({ id, children, sub }: { id: string; children: ReactNode; sub?: ReactNode }) {
  return <><h2 id={id} translate="no">{children}<span className="text-accent" translate="no">.</span></h2>{sub && <p className="page-sub">{sub}</p>}</>;
}

export function DetailList({ items }: { items: string[] }) {
  return <ul className="detail-list">{items.map((item) => <li key={item}><ArrowText>{item}</ArrowText></li>)}</ul>;
}
