import { attachmentDisplayText, publicAttachment } from "../upload-policy";
import type { SessionEventRow, StreamDelta } from "../contracts";
export const PUBLIC_ERROR = "Chat is unavailable right now. Try again in a moment.";
// A label alone is English, not a secret. The agent's job is to ASK for a booking
// confirmation, so "send over your flight booking confirmation" must survive intact;
// only a label followed by a value-shaped token is a real disclosure. Redacting the
// word after every bare `booking`/`confirmation`/`token` mangled ordinary prose.
const SECRET_LABEL = String.raw`(?:api[_ -]?key|secret|password|passphrase|credential|access[_ -]?token|auth(?:orization)?[_ -]?token|token|booking(?:\s+(?:ref(?:erence)?|code|number|id))?|confirmation(?:\s+(?:code|number|id))?|reference(?:\s+(?:code|number|id))?|record\s+locator|PNR)`;
// Value-shaped, judged case-sensitively: an alphanumeric run carrying a digit, or a
// 4+ character all-caps code. Ordinary lowercase words ("confirmation", "hidden",
// "of") are neither, so a label in a sentence redacts nothing.
const valueShaped = (value: string) => /\d/.test(value) || /^[A-Z0-9]{4,}$/.test(value);
// The label match itself is case-insensitive; the value test above is not, which is
// why the value cannot be validated inside this expression.
const LABELLED_SECRET = new RegExp(String.raw`\b${SECRET_LABEL}\b[ \t]*(?:is|are|=|:|#|->)?[ \t]*(?:["'\u2018\u201c]\s*)?([A-Za-z0-9][A-Za-z0-9+/=._-]*)\b`, "gi");
// An unlabelled reference/confirmation code: uppercase, six or more characters, and
// mixing letters with digits. "GENEVA" is a place and "F12" is an apartment; "ABC123"
// is a booking reference and must never reach this public, unauthenticated page.
const STANDALONE_CODE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b/g;
// A card-length digit run, separators allowed. Dates, times and counts are far shorter.
const CARD_NUMBER = /\b(?:\d[ -]?){12,19}\b/g;
export function publicText(text: string): string {
  if (/PrismaClient|SQLSTATE|ECONN(?:REFUSED|RESET)|ETIMEDOUT|Traceback \(most recent|stack trace|postgres(?:ql)?:\/\//i.test(text)) return PUBLIC_ERROR;
  return attachmentDisplayText(text)
    .replace(/\b(?:sk-[\w-]*|Bearer\s+\S*|(?:postgres(?:ql)?|https?):\/\/[^\s]*@[^\s]*)/gi, "[redacted]")
    .replace(LABELLED_SECRET, (match, value: string) => (valueShaped(value) ? "[redacted]" : match))
    .replace(STANDALONE_CODE, "[redacted]")
    .replace(CARD_NUMBER, "[redacted]")
    .replace(/-----BEGIN[\s\S]*$/g, "[redacted]");
}
const publicKeys = new Set(["text", "delivery", "requestId", "sourceSections", "activityEventId", "canonicalEventId", "providerEventId", "threadId", "parentThreadId", "threadRole", "threadStatus", "agentName", "activityKind", "activityLabel", "toolName", "invocationId", "ok", "continuation"]);
export function publicRow<T extends SessionEventRow>(row: T): T {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.payload)) {
    if (publicKeys.has(key)) payload[key] = typeof value === "string" ? publicText(value) : Array.isArray(value) ? value.filter(v => typeof v === "string").map(publicText) : typeof value === "boolean" || value === null ? value : undefined;
  }
  const upload = publicAttachment(row.payload.upload);
  if (upload) payload.upload = upload;
  if (row.payload.error) payload.error = PUBLIC_ERROR;
  if (row.payload.deliveryError) payload.deliveryError = PUBLIC_ERROR;
  if (row.type.endsWith("failed") && row.payload.message) payload.message = PUBLIC_ERROR;
  if (row.type === "tool_call") { payload.activityLabel = "Checking trip notes"; }
  if (row.type === "tool_result") { payload.activityLabel = payload.ok === false ? "Trip notes unavailable" : "Checked trip notes"; }
  return { ...row, payload };
}
export function publicDelta(delta: StreamDelta): StreamDelta {
  // Do not release an incomplete lexical unit: a secret/reference may span
  // multiple provider fragments. Reasoning is never exposed to this public page.
  const text = delta.variant === "reasoning" ? "Thinking through the next step..." : delta.done ? delta.text : delta.text.replace(/\S+$/, "");
  return { ...delta, text: publicText(text), ...(delta.activityLabel ? { activityLabel: publicText(delta.activityLabel) } : {}) };
}
