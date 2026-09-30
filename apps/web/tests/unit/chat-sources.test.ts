import { describe, expect, it } from "vitest";
import { parseAnswerSources } from "../../src/lib/chat/sources";

describe("decoded design source suffix", () => {
  it("keeps SRC_MAP ordering and deduplicates matching sections", () => {
    const answer = parseAnswerSources("Trip answer.\nSource: links, schedule and events, pricing and spots, rooms, flights, shuttle, chalet, chef");
    expect(answer.body).toBe("Trip answer.");
    expect(answer.sources.map((source) => source.id)).toEqual(["shuttle", "flights", "rooms", "spots", "chef", "schedule", "chalet", "links"]);
    expect(answer.sources.map((source) => source.href)).toEqual(["/shuttle", "/flights", "/rooms", "/spots", "/chef", "/schedule", "/chalet", "/links"]);
  });
  it.each(["The Source: Flights is quoted here.", "Source: Flights\nMore answer.", "No source required for intake.", "Resource: Flights", "Source:\nFlights"])("does not strip a non-suffix source line: %s", (text) => {
    expect(parseAnswerSources(text)).toEqual({ body: text, sources: [] });
  });
  it("accepts a case-insensitive final line and leaves markdown as plain text", () => {
    expect(parseAnswerSources("**Plain text**\r\n  source: Rooms  \r\n")).toEqual({ body: "**Plain text**", sources: [{ id: "rooms", label: "Rooms", href: "/rooms" }] });
  });
  it("does not invent a source for unknown sections", () => {
    expect(parseAnswerSources("Ask the organizer.\nSource: Unknown")).toEqual({ body: "Ask the organizer.", sources: [] });
  });
});
