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

  it("rejects invalid handles without making a request", async () => {
    const fetcher: InstagramAvatarFetcher = vi.fn(async () => new Response(""));
    const resolver = createInstagramAvatarResolver(fetcher);

    expect(await resolver.get("../private")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
