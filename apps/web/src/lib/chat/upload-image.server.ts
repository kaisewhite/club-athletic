import { UPLOAD_EDGE } from "./upload-policy";

/** Bun 1.4's autoOrient applies EXIF orientation before resize. rotate requires
 * explicit degrees; calling rotate() is NOT the documented auto-orient API.
 * https://bun.com/docs/runtime/image. No pixels or pipeline escape this call.
 * Native decoded buffers belong to Bun's awaited terminal (no dispose API).
 */
export async function normaliseImage(bytes: Uint8Array): Promise<Uint8Array> {
  const image = new Bun.Image(bytes, { autoOrient: true, maxPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (metadata.width < 1 || metadata.height < 1) throw new Error("Invalid image dimensions");
  return image.resize(UPLOAD_EDGE, UPLOAD_EDGE, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).bytes();
}
