import type { ReactNode } from "react";
import { getLinks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/links";

const INLINE_LINK = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)]+)\)/g;

function renderNoteLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of line.matchAll(INLINE_LINK)) {
    const [source, label, href] = match;
    const start = match.index ?? 0;
    if (start > cursor) parts.push(line.slice(cursor, start));
    const external = href.startsWith("http://") || href.startsWith("https://");
    parts.push(<a key={key++} className="resource-link-inline" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{label}</a>);
    cursor = start + source.length;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

function ResourceNote({ note, group }: { note: string | null; group: string }) {
  if (!note) return null;
  const lines = note.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1 && group !== "Ski equipment") return <p className="resource-link-note">{renderNoteLine(lines[0]!)}</p>;
  return <ul className="resource-link-details">
    {lines.map((line, index) => <li key={`${index}-${line}`}>{renderNoteLine(line)}</li>)}
  </ul>;
}

export async function loader() {
  return { links: await getLinks() };
}

/**
 * Grouped, and every link says what it is for. Owner, 2026-09-29: "It's not
 * really obvious what each one is." The group, label and description are all
 * the Link row's; the page only arranges them.
 */
export default function Links({ loaderData }: Route.ComponentProps) {
  const groups = [...new Set(loaderData.links.map((link) => link.group))];
  return <section aria-labelledby="links-heading">
    <PageHeading id="links-heading" sub="Links you may need, grouped by purpose.">Links</PageHeading>
    {groups.map((group) => <section key={group} className="link-section" aria-labelledby={`links-${group}`}>
      <h3 id={`links-${group}`} className="detail-kicker">{group}</h3>
      <div className="link-list">
        {loaderData.links.filter((link) => link.group === group).map((link) => <article className="resource-link" key={link.id} data-group={link.group}>
          <h4 className="resource-link-heading">{group === "Ski equipment" ? link.label : <a className="resource-link-title" href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}>
            <span className="link-name">{link.label}</span><span className="text-accent" aria-hidden="true">↗</span>
          </a>}</h4>
          <ResourceNote note={link.note} group={group} />
        </article>)}
      </div>
    </section>)}
  </section>;
}
