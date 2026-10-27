import { describe, expect, it, vi } from "vitest";
import { guestAvatarResponse } from "../../app/lib/guest-avatar-response.server";

describe("guest avatar API", () => {
  it("serves an avatar for a confirmed guest handle", async () => {
    const response = await guestAvatarResponse("newguest", {
      isKnownHandle: async () => true,
      getAvatar: async () => ({ bytes: new Uint8Array([4, 5, 6]), contentType: "image/jpeg" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([4, 5, 6]);
  });

  it("does not look up an avatar for a handle outside the guest roster", async () => {
    const getAvatar = vi.fn(async () => null);
    const response = await guestAvatarResponse("stranger", {
      isKnownHandle: async () => false,
      getAvatar,
    });

    expect(response.status).toBe(404);
    expect(getAvatar).not.toHaveBeenCalled();
  });
});
