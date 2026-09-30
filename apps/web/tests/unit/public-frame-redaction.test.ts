import { describe, expect, it } from "vitest";
import { PUBLIC_ERROR, publicDelta, publicText } from "../../src/lib/chat/runtime/public-frame.server";

/** The guest page is public and unauthenticated, so a real reference or credential
 * must never reach it. The redactor was also destroying ordinary prose: a bare
 * `booking`, `confirmation`, `token` or `secret` matched on its own and swallowed the
 * following word, so the agent could not say the words "booking confirmation" — the
 * exact phrase §2.13b requires it to ask for. Both directions are asserted here. */
describe("public text redaction keeps prose and still removes secrets", () => {
  it("leaves the agent's ordinary prose untouched", () => {
    for (const prose of [
      "Send over your flight booking confirmation and I can help check it works.",
      "Happy to check it against the deadlines if you send the booking confirmation.",
      "I'll confirm the details with the organizer.",
      "Consider it your token of appreciation.",
      "Your booking is fine, and the confirmation is with the organizer.",
      "The coach leaves GENEVA at 11:00 and the chalet is 326 m2 over three levels.",
      "Apartments F12 and F21 sleep 10-20 guests across 8 bedrooms.",
      "Your password is never something I would ask for here.",
    ]) {
      expect(publicText(prose)).toBe(prose);
    }
  });

  it("still redacts real secret values and reference codes", () => {
    const cases: [string, RegExp][] = [
      ["Your key is sk-ant-api03-abcdef123", /sk-ant/],
      ["Authorization: Bearer abc123def456", /abc123def456/],
      ["booking reference: ABC123", /ABC123/],
      ["Booking reference ABC123 and sk-secret-key", /ABC123|secret/],
      ["PNR: XY12Z9", /XY12Z9/],
      ["confirmation code QR7788", /QR7788/],
      ["api_key=sk-live-991122", /sk-live|991122/],
      ["The card was 4111 1111 1111 1111", /4111 1111/],
      ["-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----", /BEGIN RSA|MIIEow/],
      ["Reference number: BK9021", /BK9021/],
    ];
    for (const [raw, leaked] of cases) {
      const safe = publicText(raw);
      expect(safe, raw).not.toMatch(leaked);
      expect(safe, raw).toMatch(/\[redacted\]|Chat is unavailable/);
    }
  });

  it("replaces an internal failure rather than redacting around it", () => {
    expect(publicText("postgres://user:pass@host/db")).toBe(PUBLIC_ERROR);
    expect(publicText("PrismaClient failed to connect")).toBe(PUBLIC_ERROR);
  });

  it("keeps withholding an unfinished fragment and never exposes raw reasoning", () => {
    expect(publicDelta({ blockId: "x", variant: "message", text: "Hello sk-secr", done: false }).text).toBe("Hello ");
    expect(publicDelta({ blockId: "x", variant: "reasoning", text: "password secret", done: false }).text).toBe(
      "Thinking through the next step...",
    );
  });

  it("streams a growing preview of ordinary prose without mangling it", () => {
    // The cumulative preview is redacted on every frame, so a rule that fires on a
    // bare label would corrupt the text mid-stream and then again at the end.
    const answer = "Send over your flight booking confirmation and I can check it.";
    for (let length = 1; length <= answer.length; length++) {
      const frame = publicDelta({ blockId: "b", variant: "message", text: answer.slice(0, length), done: false });
      expect(frame.text, answer.slice(0, length)).not.toMatch(/\[redacted\]/);
    }
    expect(publicDelta({ blockId: "b", variant: "message", text: answer, done: true }).text).toBe(answer);
  });
});
