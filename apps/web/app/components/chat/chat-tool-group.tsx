import { useId, useState } from "react";
import type { ActivityEvent } from "@/lib/chat/contracts";
import { suspendAutoScrollFollow } from "../../lib/chat/use-auto-scroll";

export type ToolGroup = Extract<ActivityEvent, { kind: "group" }>;
// edge's ordered, expandable group. Public guests get status, never raw params,
// command lines, tool errors or diagnostic payloads (Q8).
export function ChatToolGroup({ group, live = false }: { group: ToolGroup; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className="chat-tool-group" aria-label="Trip note activity">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => {
      suspendAutoScrollFollow(); setOpen(value => !value);
    }}>{group.label}<span aria-hidden="true">{open ? " −" : " +"}</span></button>
    {/* A single-tool group's header already IS the tool's name, so repeating it on
        the row read as "Read / Read / Checked trip notes." (owner, 2026-09-28:
        "Is there any reason why it says 'read' twice?"). The row label only earns
        its place when it says something the header does not. */}
    {open && <div id={id}>{group.items.map((item, index) => <div key={`${group.id}:${index}`} className="chat-tool-row" data-status={item.status}>
      {item.label !== group.label && <strong>{item.label}</strong>}
      <span>{item.status === "error" ? "Trip notes unavailable." : item.status === "pending" ? live ? "Checking trip notes…" : "No result received." : "Checked trip notes."}</span>
    </div>)}</div>}
  </section>;
}
