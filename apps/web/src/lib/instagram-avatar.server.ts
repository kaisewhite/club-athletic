export type InstagramAvatar = { bytes: Uint8Array; contentType: string };
export type InstagramAvatarFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MAX_HANDLE_LENGTH = 30;
const MAX_PROFILE_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export function isInstagramHandle(value: string) {
  return value.length <= MAX_HANDLE_LENGTH && /^[A-Za-z0-9._]+$/.test(value) && value !== "." && value !== "..";
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'");
}

function profileImageUrl(html: string) {
  const tag = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)?.[0];
  const content = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
  return content ? decodeHtml(content) : null;
}

function isInstagramCdnUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      (host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net"));
  } catch {
    return false;
  }
}

async function readLimitedText(response: Response, maximum: number) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readLimitedBytes(response: Response, maximum: number) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createInstagramAvatarResolver(fetcher: InstagramAvatarFetcher = fetch, now = Date.now) {
  const cache = new Map<string, { expiresAt: number; avatar: InstagramAvatar | null }>();
  const pending = new Map<string, Promise<InstagramAvatar | null>>();

  async function load(handle: string): Promise<InstagramAvatar | null> {
    try {
      const profileResponse = await fetcher(`https://www.instagram.com/${encodeURIComponent(handle)}/?hl=en`, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          referer: "https://www.instagram.com/",
          "user-agent": "Mozilla/5.0 (compatible; ClubAthletic/1.0)",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!profileResponse.ok) return null;
      const html = await readLimitedText(profileResponse, MAX_PROFILE_HTML_BYTES);
      const imageUrl = html ? profileImageUrl(html) : null;
      if (!imageUrl || !isInstagramCdnUrl(imageUrl)) return null;

      const imageResponse = await fetcher(imageUrl, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ClubAthletic/1.0)" },
        signal: AbortSignal.timeout(8_000),
      });
      const contentType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!imageResponse.ok || !allowedImageTypes.has(contentType)) return null;
      const bytes = await readLimitedBytes(imageResponse, MAX_IMAGE_BYTES);
      return bytes?.length ? { bytes, contentType } : null;
    } catch {
      return null;
    }
  }

  async function get(handle: string): Promise<InstagramAvatar | null> {
    if (!isInstagramHandle(handle)) return null;
    const cached = cache.get(handle);
    if (cached && cached.expiresAt > now()) return cached.avatar;
    if (cached) cache.delete(handle);
    const existing = pending.get(handle);
    if (existing) return existing;

    const request = load(handle).then((avatar) => {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(handle, { avatar, expiresAt: now() + (avatar ? CACHE_TTL_MS : FAILURE_TTL_MS) });
      return avatar;
    }).finally(() => pending.delete(handle));
    pending.set(handle, request);
    return request;
  }

  return { get };
}

export const getInstagramAvatar = createInstagramAvatarResolver().get;
