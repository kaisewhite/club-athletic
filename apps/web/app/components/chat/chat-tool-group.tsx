import { useId, useState } from "react";
import type { ActivityEvent } from "@/lib/chat/contracts";
import { suspendAutoScrollFollow } from "../../lib/chat/use-auto-scroll";

export type ToolGroup = Extract<ActivityEvent, { kind: "group" }>;
// edge's ordered, expandable group. Public guests get status, never raw params,
// command lines, tool errors or diagnostic payloads (Q8).
export function ChatToolGroup({ group, live = false }: { group: ToolGroup; live?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const details = [...group.items.reduce((result, item) => {
    const existing = result.get(item.label);
    if (existing) {
      existing.count += 1;
      if (item.status === "error") existing.status = "error";
      if (item.status === "pending" && existing.status === "ok") existing.status = "pending";
    } else {
      result.set(item.label, { label: item.label, count: 1, status: item.status });
    }
    return result;
  }, new Map<string, { label: string; count: number; status: "ok" | "error" | "pending" }>()).values()]
    .filter(item => !(item.label === "Used Tool" && item.status === "ok"));
  return <section className="chat-tool-group" aria-label="Trip note activity">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => {
      suspendAutoScrollFollow(); setOpen(value => !value);
    }}>{group.label}<span aria-hidden="true">{open ? " −" : " +"}</span></button>
    {open && <div id={id}>{details.map(item => <div key={`${group.id}:${item.label}`} className="chat-tool-row" data-status={item.status}>
      <strong>{item.label}{item.count > 1 ? ` ×${item.count}` : ""}</strong>
      {item.status !== "ok" && <span>{item.status === "error" ? "Trip notes unavailable." : live ? "Checking trip notes…" : "No result received."}</span>}
    </div>)}</div>}
  </section>;
}
