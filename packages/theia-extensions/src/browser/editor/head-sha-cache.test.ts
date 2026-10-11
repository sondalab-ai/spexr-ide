import { describe, expect, it } from "vitest";
import { HeadShaCache } from "./head-sha-cache.js";

function make(ttl = 300) {
  const state = { reads: 0, sha: "aaa", time: 0 };
  const cache = new HeadShaCache(async () => (state.reads++, state.sha), () => state.time, ttl);
  return { cache, state };
}

describe("HEAD's sha (S6c, E7)", () => {
  it("is one read for the callers of one status event, however many editors ask", async () => {
    const { cache, state } = make();
    const shas = await Promise.all([cache.get("/r"), cache.get("/r"), cache.get("/r")]);
    expect(shas).toEqual(["aaa", "aaa", "aaa"]);
    expect(state.reads).toBe(1);
  });

  it("is read again at the next refresh, since a HEAD move with the same status raises no event", async () => {
    const { cache, state } = make();
    await cache.get("/r");
    state.sha = "bbb"; // a reset --hard, say
    state.time = 301;
    expect(await cache.get("/r")).toBe("bbb");
    expect(state.reads).toBe(2);
  });

  it("is read again after a clear, and each repository has its own", async () => {
    const { cache, state } = make();
    await cache.get("/a");
    await cache.get("/b");
    expect(state.reads).toBe(2);
    cache.clear();
    await cache.get("/a");
    expect(state.reads).toBe(3);
  });

  it("does not keep a read that was running when it was cleared", async () => {
    let release!: (sha: string) => void;
    let calls = 0;
    const cache = new HeadShaCache(() => (++calls === 1 ? new Promise<string>((resolve) => (release = resolve)) : Promise.resolve("fresh")), () => 0);
    const late = cache.get("/r");
    cache.clear();
    expect(await cache.get("/r")).toBe("fresh");
    release("stale");
    expect(await late).toBe("stale"); // the late caller gets its own answer ...
    expect(await cache.get("/r")).toBe("fresh"); // ... which is not what the cache holds
  });
});
