import { describe, expect, it } from "vitest";
import { backdropChoice } from "./backdrop.js";
import { CURATED } from "./photo-set.js";
import { DEFAULT_BACKDROP_PHOTO_QUERIES } from "../preferences/spexr-preferences.js";

const prefs =
  (values: Record<string, unknown>) =>
  (key: string): unknown =>
    values[key];

describe("backdropChoice", () => {
  it("draws the Game of Life unless the photo is asked for", () => {
    expect(backdropChoice(prefs({}))).toEqual({ kind: "life" });
    expect(backdropChoice(prefs({ "spexr.backdrop.kind": "nonsense" }))).toEqual({ kind: "life" });
  });

  it("finds photos through Openverse with the default queries and a one-minute interval", () => {
    expect(backdropChoice(prefs({ "spexr.backdrop.kind": "photo" }))).toEqual({
      kind: "photo",
      source: { kind: "openverse", queries: DEFAULT_BACKDROP_PHOTO_QUERIES },
      intervalMs: 60_000,
    });
  });

  it("uses Unsplash only with a key, and Openverse otherwise", () => {
    const base = {
      "spexr.backdrop.kind": "photo",
      "spexr.backdrop.photoSource": "unsplash",
      "spexr.backdrop.photoQueries": ["nebula"],
    };
    expect(
      backdropChoice(prefs({ ...base, "spexr.backdrop.unsplashAccessKey": " k " })),
    ).toMatchObject({
      source: { kind: "unsplash", queries: ["nebula"], key: "k" },
    });
    expect(
      backdropChoice(prefs({ ...base, "spexr.backdrop.unsplashAccessKey": "" })),
    ).toMatchObject({
      source: { kind: "openverse", queries: ["nebula"] },
    });
  });

  it("serves the bundled set for the curated source, and your URLs over any source", () => {
    expect(
      backdropChoice(
        prefs({ "spexr.backdrop.kind": "photo", "spexr.backdrop.photoSource": "curated" }),
      ),
    ).toMatchObject({
      source: { kind: "list", photos: CURATED },
    });
    expect(
      backdropChoice(
        prefs({
          "spexr.backdrop.kind": "photo",
          "spexr.backdrop.photos": [" https://x/a.jpg ", "", 3],
        }),
      ),
    ).toMatchObject({ source: { kind: "list", photos: [{ url: "https://x/a.jpg" }] } });
  });

  it("holds each photo at least ten seconds", () => {
    const at = (s: unknown) =>
      backdropChoice(
        prefs({ "spexr.backdrop.kind": "photo", "spexr.backdrop.photoIntervalSeconds": s }),
      );
    expect(at(3)).toMatchObject({ intervalMs: 10_000 });
    expect(at(45)).toMatchObject({ intervalMs: 45_000 });
    expect(at("nonsense")).toMatchObject({ intervalMs: 60_000 });
  });
});
