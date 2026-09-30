// SRC_MAP and source parsing ported from docs/meribel-source-decoded.html.
// Only a final standalone Source line is metadata; inline prose remains intact.
export const SRC_MAP = [
  ["shuttle", "shuttle"], ["flight", "flights"], ["room", "rooms"],
  ["spot", "spots"], ["pric", "spots"], ["chef", "chef"],
  ["event", "schedule"], ["schedule", "schedule"], ["chalet", "chalet"], ["link", "links"],
] as const;
export type SourceSection = (typeof SRC_MAP)[number][1];
export interface AnswerSource { id: SourceSection; label: string; href: string }
const SOURCE_LABELS: Record<SourceSection, string> = {
  shuttle: "Shuttle", flights: "Flights", rooms: "Rooms", spots: "Pricing",
  chef: "Chef", schedule: "Schedule", chalet: "Chalet", links: "Links",
};
export function parseAnswerSources(answer: string): { body: string; sources: AnswerSource[] } {
  const match = /(?:^|\r?\n)[\t ]*Source:[\t ]*([^\r\n]+?)[\t ]*(?:\r?\n[\t ]*)*$/i.exec(answer);
  if (!match) return { body: answer, sources: [] };
  const body = answer.slice(0, match.index).trim();
  const seen = new Set<SourceSection>();
  const sources: AnswerSource[] = [];
  const suffix = match[1]!.toLowerCase();
  for (const [keyword, id] of SRC_MAP) {
    if (suffix.includes(keyword) && !seen.has(id)) {
      seen.add(id);
      sources.push({ id, label: SOURCE_LABELS[id], href: `/${id}` });
    }
  }
  return { body, sources };
}
