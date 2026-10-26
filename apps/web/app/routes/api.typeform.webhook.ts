import { createHmac, timingSafeEqual } from "node:crypto";
import { applyTypeformGuestUpdate, TypeformGuestMatchError } from "@/lib/db/typeform-writes.server";
import { InvalidTypeformResponseError, parseTypeformGuestUpdate } from "@/lib/typeform/guest-response.server";

const MAX_BODY_BYTES = 256 * 1024;

async function readRawBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function validSignature(header: string | null, body: Buffer, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("base64")}`;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(header);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET;
  if (!secret) return Response.json({ ok: false, error: "Webhook is not configured." }, { status: 503 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ ok: false, error: "Expected a JSON payload." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Payload too large." }, { status: 413 });

  const body = await readRawBody(request);
  if (!body) return Response.json({ ok: false, error: "Payload too large." }, { status: 413 });
  if (!validSignature(request.headers.get("typeform-signature"), body, secret)) {
    return Response.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const update = parseTypeformGuestUpdate(payload);
    const result = await applyTypeformGuestUpdate(update);
    return Response.json({ ok: true, duplicate: result.duplicate }, { status: 200 });
  } catch (error) {
    if (error instanceof TypeformGuestMatchError) {
      console.warn(`Typeform guest response needs a unique roster match (${error.matchCount} matches).`);
      return Response.json({ ok: false, error: "Guest could not be matched to the trip roster." }, { status: 409 });
    }
    if (error instanceof InvalidTypeformResponseError) {
      console.warn("Typeform sent a response that did not match the configured form fields.");
      return Response.json({ ok: false, error: "Form response could not be mapped." }, { status: 422 });
    }
    throw error;
  }
}

export function loader() {
  return Response.json({ ok: false, error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
