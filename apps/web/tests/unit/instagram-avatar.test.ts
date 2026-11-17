import { describe, expect, it, vi } from "vitest";
import { createInstagramAvatarResolver, type InstagramAvatarFetcher } from "../../src/lib/instagram-avatar.server";

describe("Instagram avatar resolver", () => {
  it("fetches a public profile image and caches it", async () => {
    const fetcher: InstagramAvatarFetcher = vi.fn(async (input) => {
      if (String(input).includes("www.instagram.com/")) {
        return new Response('<meta property="og:image" content="https://scontent.cdninstagram.com/avatar.jpg">');
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    });
    const resolver = createInstagramAvatarResolver(fetcher);

    const first = await resolver.get("new.guest_1");
    const second = await resolver.get("new.guest_1");

    expect(first?.contentType).toBe("image/jpeg");
    expect([...first!.bytes]).toEqual([1, 2, 3]);
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects image URLs outside Instagram's image CDNs", async () => {
    const fetcher: InstagramAvatarFetcher = vi.fn(async () =>
      new Response('<meta property="og:image" content="https://attacker.example/image.jpg">'));
    const resolver = createInstagramAvatarResolver(fetcher);

    expect(await resolver.get("guest")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects Instagram's oversized generic profile image", async () => {
    const genericImage = new Uint8Array(24);
    genericImage.set([137, 80, 78, 71, 13, 10, 26, 10]);
    genericImage.set([73, 72, 68, 82], 12);
    new DataView(genericImage.buffer).setUint32(16, 4168);
    new DataView(genericImage.buffer).setUint32(20, 4168);
    const fetcher: InstagramAvatarFetcher = vi.fn(async (input) => String(input).includes("www.instagram.com/")
      ? new Response('<meta property="og:image" content="https://scontent.cdninstagram.com/avatar.png">')
      : new Response(genericImage, { headers: { "content-type": "image/png" } }));
    const resolver = createInstagramAvatarResolver(fetcher);

    expect(await resolver.get("guest")).toBeNull();
  });

  it("rejects invalid handles without making a request", async () => {
    const fetcher: InstagramAvatarFetcher = vi.fn(async () => new Response(""));
    const resolver = createInstagramAvatarResolver(fetcher);

    expect(await resolver.get("../private")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
