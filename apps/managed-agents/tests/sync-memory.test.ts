import { describe, expect, test } from "bun:test";
import { reconcileMemoryStore } from "../scripts/sync-memory.ts";

describe("trip memory sync", () => {
  test("updates changed owned memories, creates missing ones, and leaves extras alone", async () => {
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const request = async (path: string, method = "GET", body?: unknown) => {
      calls.push({ path, method, body });
      if (path === "/memory_stores/memstore_fixture") {
        return { id: "memstore_fixture", name: "club-athletic-meribel-2027-facts", archived_at: null };
      }
      if (path.endsWith("/memories?limit=100")) {
        return { data: [
          { id: "memory_readme", path: "/README.txt", content_sha256: "stale" },
          { id: "memory_extra", path: "/other-writer.txt", content_sha256: "old" },
        ], has_more: false };
      }
      return { id: "memory_result" };
    };
    const result = await reconcileMemoryStore("memstore_fixture", "{\"name\":\"club-athletic-meribel-2027-facts\",\"description\":\"x\"}", [
      { path: "/README.txt", content: "current README\n" },
      { path: "/trip/overview.txt", content: "new overview\n" },
    ], request);

    expect(result).toEqual({ created: 1, updated: 1, unchanged: 0, extra: ["/other-writer.txt"] });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /memory_stores/memstore_fixture",
      "POST /memory_stores/memstore_fixture",
      "GET /memory_stores/memstore_fixture/memories?limit=100",
      "POST /memory_stores/memstore_fixture/memories/memory_readme",
      "POST /memory_stores/memstore_fixture/memories",
    ]);
    expect(calls[3]?.body).toMatchObject({
      precondition: { type: "content_sha256", content_sha256: "stale" },
      content: "current README\n",
    });
  });
});
