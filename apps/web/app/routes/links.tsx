import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { getLinks } from "@/lib/db/repository.server";
import { PageHeading } from "../components/trip-details";
import type { Route } from "./+types/links";
import { ArrowText } from "../components/arrow-text";

const INLINE_LINK = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^)]+)\)/g;

function renderNoteLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of line.matchAll(INLINE_LINK)) {
    const [source, label, href] = match;
    const start = match.index ?? 0;
    if (start > cursor) parts.push(<ArrowText key={key++}>{line.slice(cursor, start)}</ArrowText>);
    const external = href.startsWith("http://") || href.startsWith("https://");
    parts.push(<a key={key++} className="resource-link-inline" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}><ArrowText>{label}</ArrowText></a>);
    cursor = start + source.length;
  }
  if (cursor < line.length) parts.push(<ArrowText key={key++}>{line.slice(cursor)}</ArrowText>);
  return parts;
}

function ResourceNote({ note }: { note: string | null }) {
  if (!note) return null;
  const lines = note.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
    <div className="resource-guide">
    {groups.map((group, index) => <section key={group} className="link-section" aria-labelledby={`links-${group}`}>
      <div className="resource-section-heading"><span>{String(index + 1).padStart(2, "0")}</span><h3 id={`links-${group}`} className="detail-kicker"><ArrowText>{group}</ArrowText></h3></div>
      <div className="link-list">
        {loaderData.links.filter((link) => link.group === group).map((link) => <article className="resource-link" key={link.id} data-group={link.group}>
          <h4 className="resource-link-heading">{group === "Ski equipment" ? <ArrowText>{link.label}</ArrowText> : <a className="resource-link-title" href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}>
            <span className="link-name"><ArrowText>{link.label}</ArrowText></span><span className="text-accent" aria-hidden="true"><ArrowUpRight size="1em" /></span>
          </a>}</h4>
          <ResourceNote note={link.note} />
        </article>)}
      </div>
    </section>)}
    </div>
  </section>;
}
