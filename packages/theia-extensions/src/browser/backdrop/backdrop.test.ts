import { describe, expect, it } from "vitest";
import { backdropChoice } from "./backdrop.js";
import { CURATED_PHOTOS } from "./photo-set.js";

describe("backdropChoice", () => {
  it("draws the Game of Life unless the photo is asked for", () => {
    expect(backdropChoice(undefined, undefined).kind).toBe("life");
    expect(backdropChoice("nonsense", []).kind).toBe("life");
    expect(backdropChoice("photo", []).kind).toBe("photo");
  });

  it("uses the curated set when no URL is given", () => {
    expect(backdropChoice("photo", []).photos).toBe(CURATED_PHOTOS);
    expect(backdropChoice("photo", ["", "  ", 3]).photos).toBe(CURATED_PHOTOS);
    expect(backdropChoice("photo", "https://x/a.jpg").photos).toBe(CURATED_PHOTOS);
  });

  it("keeps the user's URLs, trimmed", () => {
    expect(backdropChoice("photo", [" https://x/a.jpg ", "https://x/b.png"]).photos).toEqual([
      "https://x/a.jpg",
      "https://x/b.png",
    ]);
  });
});
