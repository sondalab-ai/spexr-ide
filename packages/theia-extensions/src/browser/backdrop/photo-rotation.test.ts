import { describe, expect, it } from "vitest";
import { PhotoRotation, type Ready } from "./photo-rotation.js";
import type { Photo } from "./photo-feed.js";

/** A feed that serves `urls` in order, then empty photos. */
const feedOf = (urls: string[]) => {
  let i = 0;
  return async (): Promise<Photo> => ({ url: urls[i++] ?? "" });
};

describe("PhotoRotation", () => {
  it("shows the first photo, then decodes the next one ahead", async () => {
    const loads: string[] = [];
    const shown: string[] = [];
    const r = new PhotoRotation({
      next: feedOf(["a", "b", "c"]),
      load: async (url) => (loads.push(url), `px:${url}`),
      show: (ready: Ready<string>) => shown.push(ready.pixels),
    });
    await r.advance();
    expect(shown).toEqual(["px:a"]);
    await Promise.resolve();
    expect(loads).toEqual(["a", "b"]);

    await r.advance();
    expect(shown).toEqual(["px:a", "px:b"]);
    expect(loads).toEqual(["a", "b", "c"]);
  });

  it("skips photos that fail, up to its tries", async () => {
    const shown: string[] = [];
    const r = new PhotoRotation({
      next: feedOf(["bad1", "bad2", "good"]),
      load: async (url) => {
        if (url.startsWith("bad")) throw new Error("tainted");
        return url;
      },
      show: (ready: Ready<string>) => shown.push(ready.photo.url),
    });
    await r.advance();
    expect(shown).toEqual(["good"]);

    const none: string[] = [];
    const stubborn = new PhotoRotation({
      next: feedOf(["x1", "x2", "x3"]),
      load: async () => {
        throw new Error("offline");
      },
      show: (ready: Ready<string>) => none.push(ready.photo.url),
      tries: 2,
    });
    await expect(stubborn.advance()).resolves.toBeUndefined();
    expect(none).toEqual([]);
  });

  it("stops at an empty photo", async () => {
    let loads = 0;
    const r = new PhotoRotation({
      next: feedOf([]),
      load: async () => (loads++, "px"),
      show: () => undefined,
    });
    await r.advance();
    expect(loads).toBe(0);
  });

  it("drops an advance while one is loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const shown: string[] = [];
    const r = new PhotoRotation({
      next: feedOf(["a", "b", "c"]),
      load: async (url) => (url === "a" ? (await gate, url) : url),
      show: (ready: Ready<string>) => shown.push(ready.pixels),
    });
    const first = r.advance();
    await r.advance();
    release();
    await first;
    expect(shown).toEqual(["a"]);
  });

  it("shows nothing once disposed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const shown: string[] = [];
    const r = new PhotoRotation({
      next: feedOf(["a"]),
      load: async (url) => (await gate, url),
      show: (ready: Ready<string>) => shown.push(ready.pixels),
    });
    const pending = r.advance();
    r.dispose();
    release();
    await pending;
    await r.advance();
    expect(shown).toEqual([]);
  });
});
