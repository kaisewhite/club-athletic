/** Bounded native fixture harness; no server, database, network or temp files.
 * Run: bun --no-install tests/integration/chat-image.ts
 * Vitest uses --encode + stdin to exercise the actual Bun normalizer. */
import assert from "node:assert/strict";
import { normaliseImage } from "../../src/lib/chat/upload-image.server";

if (process.argv.includes("--encode")) {
  const input = new Uint8Array(await Bun.stdin.arrayBuffer());
  let output: Uint8Array | undefined;
  try { output = await normaliseImage(input); await new Promise<void>((resolve, reject) => process.stdout.write(output!, error => error ? reject(error) : resolve())); }
  finally { input.fill(0); output?.fill(0); }
} else {
  const source = new Uint8Array(await Bun.file(new URL("../fixtures/chat/bedroom-map.png", import.meta.url)).arrayBuffer());
  const buffers: Uint8Array[] = [source];
  try {
    const sourceMetadata = await new Bun.Image(source).metadata();
    assert.equal(sourceMetadata.format, "png");
    const output = await normaliseImage(source); buffers.push(output);
    const dimensions = await new Bun.Image(output).metadata();
    assert.equal(dimensions.format, "webp");
    assert.ok(Math.max(dimensions.width, dimensions.height) <= 1600);
    const large = await new Bun.Image(source).resize(2400, 1800).png().bytes(); buffers.push(large);
    const capped = await normaliseImage(large); buffers.push(capped);
    const capMeta = await new Bun.Image(capped).metadata();
    assert.deepEqual([capMeta.width, capMeta.height], [1600, 1200]);
    const small = await new Bun.Image(source).resize(80, 60).png().bytes(); buffers.push(small);
    const unchanged = await normaliseImage(small); buffers.push(unchanged);
    const smallMeta = await new Bun.Image(unchanged).metadata();
    assert.deepEqual([smallMeta.width, smallMeta.height], [80, 60]);
    // Construct an EXIF Orientation=6 fixture without an EXIF library. Native
    // autoOrient rotates 80x60 to 60x80 and WebP must not carry the EXIF chunk.
    const jpeg = await new Bun.Image(small).jpeg().bytes(); buffers.push(jpeg);
    const exif = Buffer.from("ffe1002245786966000049492a0008000000010012010300010000000600000000000000", "hex");
    buffers.push(exif);
    const rotated = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]); buffers.push(rotated);
    const oriented = await normaliseImage(rotated); buffers.push(oriented);
    const rotatedMeta = await new Bun.Image(oriented).metadata();
    assert.deepEqual([rotatedMeta.width, rotatedMeta.height], [60, 80]);
    assert.equal(Buffer.from(oriented).includes(Buffer.from("EXIF")), false);
    const corrupt = source.slice(0, 33); buffers.push(corrupt);
    await assert.rejects(() => normaliseImage(corrupt));
    console.log(JSON.stringify({ png: dimensions, capped: capMeta, small: smallMeta, oriented: rotatedMeta, corruptRejected: true }));
  } finally {
    for (const buffer of buffers) buffer.fill(0);
    assert.ok(buffers.every(buffer => buffer.every(value => value === 0)));
  }
}
