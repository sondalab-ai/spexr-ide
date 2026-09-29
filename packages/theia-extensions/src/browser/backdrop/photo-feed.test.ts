import { describe, expect, it } from "vitest";
import {
  PhotoFeed,
  licenseLabel,
  openverseUrl,
  parseOpenverse,
  parseUnsplash,
  unsplashUrl,
  type Photo,
} from "./photo-feed.js";

const openverseResult = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  creator: `Creator ${id}`,
  creator_url: `https://example.org/${id}`,
  license: "by-sa",
  license_version: "2.0",
  foreign_landing_url: `https://flickr.example/${id}`,
  source: "flickr",
  thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`,
  ...extra,
});

const unsplashResult = (id: string) => ({
  id,
  urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=abc` },
  user: { name: `User ${id}`, links: { html: `https://unsplash.com/@u${id}` } },
  links: { download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc` },
});

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe("request URLs", () => {
  it("asks Openverse for commercial-use photographs on a page", () => {
    const url = new URL(openverseUrl("neon city", 3));
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "neon city",
      page: "3",
      page_size: "20",
      license_type: "commercial",
      category: "photograph",
      mature: "false",
    });
  });

  it("asks Unsplash for thirty random photos of a query", () => {
    const url = new URL(unsplashUrl("nebula"));
    expect(url.origin + url.pathname).toBe("https://api.unsplash.com/photos/random");
    expect(url.searchParams.get("query")).toBe("nebula");
    expect(url.searchParams.get("count")).toBe("30");
  });
});

describe("licenseLabel", () => {
  it("names Creative Commons licences the way their deeds do", () => {
    expect(licenseLabel("by-sa", "2.0")).toBe("CC BY-SA 2.0");
    expect(licenseLabel("cc0", "1.0")).toBe("CC0");
    expect(licenseLabel("pdm", "1.0")).toBe("Public domain");
    expect(licenseLabel("by", undefined)).toBe("CC BY");
  });
});

describe("parseOpenverse", () => {
  it("keeps the proxied thumbnail and the credit", () => {
    const [p] = parseOpenverse({ results: [openverseResult("a")] });
    expect(p).toEqual({
      url: "https://api.openverse.org/v1/images/a/thumb/",
      credit: {
        author: "Creator a",
        authorUrl: "https://example.org/a",
        via: "Openverse",
        pageUrl: "https://flickr.example/a",
        license: "CC BY-SA 2.0",
      },
    });
  });

  it("skips entries without a thumbnail and tolerates a missing creator", () => {
    const photos = parseOpenverse({
      results: [
        openverseResult("a", { thumbnail: null }),
        openverseResult("b", { creator: null, creator_url: null }),
      ],
    });
    expect(photos).toHaveLength(1);
    expect(photos[0]!.credit!.author).toBe("Unknown");
    expect(photos[0]!.credit!.authorUrl).toBeUndefined();
  });

  it("returns nothing for a body that is not a result list", () => {
    expect(parseOpenverse(null)).toEqual([]);
    expect(parseOpenverse({ detail: "throttled" })).toEqual([]);
  });
});

describe("parseUnsplash", () => {
  it("crops the raw picture to a small square and credits the photographer with referral links", () => {
    const [p] = parseUnsplash([unsplashResult("x")]);
    const url = new URL(p!.url);
    expect(url.searchParams.get("ixid")).toBe("abc");
    expect(url.searchParams.get("w")).toBe("640");
    expect(url.searchParams.get("fit")).toBe("crop");
    expect(p!.credit).toEqual({
      author: "User x",
      authorUrl: "https://unsplash.com/@ux?utm_source=spexr&utm_medium=referral",
      via: "Unsplash",
      viaUrl: "https://unsplash.com/?utm_source=spexr&utm_medium=referral",
    });
    expect(p!.shown).toBe("https://api.unsplash.com/photos/x/download?ixid=abc");
  });

  it("returns nothing for an error body", () => {
    expect(parseUnsplash({ errors: ["OAuth error"] })).toEqual([]);
  });
});

describe("PhotoFeed", () => {
  const curated: Photo[] = [{ url: "nasa-1" }, { url: "nasa-2" }];

  it("serves a batch from Openverse, one photo at a time, without repeats", async () => {
    const calls: string[] = [];
    const feed = new PhotoFeed({
      source: { kind: "openverse", queries: ["neon"] },
      fallback: curated,
      random: () => 0,
      fetch: async (url) => {
        calls.push(String(url));
        return response({ results: [openverseResult("a"), openverseResult("b")] });
      },
    });
    const first = await feed.next();
    const second = await feed.next();
    expect(new Set([first.url, second.url]).size).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it("fetches a new batch once the last one is spent, skipping photos already shown", async () => {
    let batch = 0;
    const feed = new PhotoFeed({
      source: { kind: "openverse", queries: ["neon", "nebula"] },
      fallback: curated,
      random: () => 0.5,
      fetch: async () => {
        batch++;
        return response({
          results:
            batch === 1 ? [openverseResult("a")] : [openverseResult("a"), openverseResult("c")],
        });
      },
    });
    expect((await feed.next()).url).toContain("/a/");
    expect((await feed.next()).url).toContain("/c/");
  });

  it("falls back to the curated set when the network fails or answers nothing", async () => {
    const failing = new PhotoFeed({
      source: { kind: "openverse", queries: ["neon"] },
      fallback: curated,
      random: () => 0,
      fetch: async () => {
        throw new TypeError("offline");
      },
    });
    expect(curated.map((p) => p.url)).toContain((await failing.next()).url);

    const empty = new PhotoFeed({
      source: { kind: "unsplash", queries: ["neon"], key: "k" },
      fallback: curated,
      random: () => 0,
      fetch: async () => response({ errors: ["Rate Limit Exceeded"] }, false),
    });
    expect(curated.map((p) => p.url)).toContain((await empty.next()).url);
  });

  it("sends the Unsplash key as a Client-ID header", async () => {
    let headers: HeadersInit | undefined;
    const feed = new PhotoFeed({
      source: { kind: "unsplash", queries: ["neon"], key: "secret" },
      fallback: curated,
      random: () => 0,
      fetch: async (_url, init) => {
        headers = init?.headers;
        return response([unsplashResult("x")]);
      },
    });
    await feed.next();
    expect(headers).toMatchObject({ Authorization: "Client-ID secret", "Accept-Version": "v1" });
  });

  it("cycles a fixed list without touching the network", async () => {
    const feed = new PhotoFeed({
      source: { kind: "list", photos: [{ url: "u1" }, { url: "u2" }] },
      fallback: curated,
      random: () => 0,
      fetch: async () => {
        throw new Error("no network expected");
      },
    });
    const a = await feed.next();
    const b = await feed.next();
    expect([a.url, b.url].sort()).toEqual(["u1", "u2"]);
  });
});

describe("PhotoFeed.shown", () => {
  it("reports an Unsplash photo on screen to its download endpoint, with the key", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const feed = new PhotoFeed({
      source: { kind: "unsplash", queries: ["neon"], key: "k" },
      fallback: [],
      fetch: async (url, init) => {
        calls.push([url, init]);
        return response([]);
      },
    });
    feed.shown({ url: "u", shown: "https://api.unsplash.com/photos/x/download" });
    feed.shown({ url: "v" });
    expect(calls).toEqual([
      ["https://api.unsplash.com/photos/x/download", { headers: { Authorization: "Client-ID k" } }],
    ]);
  });

  it("reports nothing for other sources", () => {
    let called = false;
    const feed = new PhotoFeed({
      source: { kind: "openverse", queries: ["neon"] },
      fallback: [],
      fetch: async () => {
        called = true;
        return response({});
      },
    });
    feed.shown({ url: "u", shown: "https://x" });
    expect(called).toBe(false);
  });
});
