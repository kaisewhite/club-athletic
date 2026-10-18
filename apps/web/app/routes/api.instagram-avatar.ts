const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const HANDLE_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'");
}

function profileHandle(profile: string | null) {
  if (!profile) return null;
  try {
    const url = new URL(profile);
    if (url.protocol !== "https:" || !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1 || !HANDLE_PATTERN.test(parts[0])) return null;
    return parts[0];
  } catch {
    return null;
  }
}

function profileImageUrl(html: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const property = tag.match(/\bproperty=["']([^"']+)["']/i)?.[1] ?? tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (property?.toLowerCase() !== "og:image") continue;
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (content) return decodeHtmlAttribute(content);
  }
  return null;
}

export async function loader({ request }: { request: Request }) {
  const handle = profileHandle(new URL(request.url).searchParams.get("profile"));
  if (!handle) return new Response("Invalid Instagram profile URL.", { status: 400 });

  try {
    const response = await fetch(`https://www.instagram.com/${handle}/`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ClubAthletic/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return new Response("Instagram profile unavailable.", { status: 404 });
    const imageUrl = profileImageUrl(await response.text());
    if (!imageUrl) return new Response("Instagram profile photo unavailable.", { status: 404 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: imageUrl,
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response("Instagram profile unavailable.", { status: 404 });
  }
}
