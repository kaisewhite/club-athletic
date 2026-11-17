import { mkdir, rename, stat } from "node:fs/promises";
import { guestInstagramHandle, guestInstagramProfiles } from "../app/lib/guest-instagrams";
import { getGuestInstagramProfiles } from "../src/lib/db/repository.server";

const outputDir = new URL("../public/guest-avatars/", import.meta.url);
const userAgent = "Mozilla/5.0 (compatible; ClubAthletic/1.0)";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'");
}

function getProfileImageUrl(html: string) {
  const tag = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i)?.[0];
  const content = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
  return content ? decodeHtml(content) : null;
}

function isRealImageUrl(url: string) {
  return url.startsWith("https://") && !url.includes("static.cdninstagram.com/rsrc.php");
}

function isUsableAvatar(bytes: Uint8Array, contentType: string) {
  return contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function hasCachedAvatar(filename: string) {
  try {
    await stat(new URL(filename, outputDir));
    return true;
  } catch {
    return false;
  }
}

await mkdir(outputDir, { recursive: true });

let profiles = guestInstagramProfiles;
try {
  const databaseProfiles = await getGuestInstagramProfiles();
  const byHandle = new Map(profiles.map((profile) => [guestInstagramHandle(profile.href), profile]));
  for (const profile of databaseProfiles) {
    if (profile.href) byHandle.set(guestInstagramHandle(profile.href), profile as { displayName: string; href: string });
  }
  profiles = [...byHandle.values()];
} catch (error) {
  console.warn(`could not read guest roster; syncing configured profiles only: ${error instanceof Error ? error.message : String(error)}`);
}

let failed = false;
for (const profile of profiles) {
  const handle = guestInstagramHandle(profile.href);
  const filename = `${handle}.jpg`;
  try {
    const profileResponse = await fetch(`${profile.href}/?hl=en`, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.instagram.com/",
        "user-agent": userAgent,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!profileResponse.ok) throw new Error(`profile returned ${profileResponse.status}`);

    const imageUrl = getProfileImageUrl(await profileResponse.text());
    if (!imageUrl || !isRealImageUrl(imageUrl)) throw new Error("Instagram returned no usable profile image");

    const imageResponse = await fetch(imageUrl, { headers: { "user-agent": userAgent }, signal: AbortSignal.timeout(15000) });
    const contentType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!imageResponse.ok || contentType !== "image/jpeg") {
      throw new Error(`image returned ${imageResponse.status}`);
    }
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (!isUsableAvatar(bytes, contentType)) throw new Error("Instagram returned a generic or invalid profile image");
    const temporaryFile = new URL(`${filename}.tmp`, outputDir);
    await Bun.write(temporaryFile, bytes);
    await rename(temporaryFile, new URL(filename, outputDir));
    console.log(`cached ${profile.displayName} -> ${filename}`);
  } catch (error) {
    if (await hasCachedAvatar(filename)) {
      console.warn(`kept ${filename}: ${error instanceof Error ? error.message : String(error)}`);
    } else {
      failed = true;
      console.error(`missing ${profile.displayName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (failed) process.exit(1);
