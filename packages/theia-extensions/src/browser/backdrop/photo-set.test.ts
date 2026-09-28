import { describe, expect, it } from "vitest";
import { CURATED_PHOTOS, nextPhoto } from "./photo-set.js";

describe("nextPhoto", () => {
  it("never repeats the photo just shown when there are two or more", () => {
    const list = ["a", "b", "c"];
    for (const r of [0, 0.2, 0.5, 0.8, 0.9999]) {
      for (const previous of list) expect(nextPhoto(list, previous, () => r)).not.toBe(previous);
    }
  });

  it("reaches every other photo", () => {
    const list = ["a", "b", "c", "d"];
    const seen = new Set([0, 0.3, 0.6, 0.9].map((r) => nextPhoto(list, "a", () => r)));
    expect([...seen].sort()).toEqual(["b", "c", "d"]);
  });

  it("picks any photo when nothing was shown yet", () => {
    expect(nextPhoto(["a", "b"], undefined, () => 0)).toBe("a");
    expect(nextPhoto(["a", "b"], undefined, () => 0.99)).toBe("b");
  });

  it("returns the only photo, and nothing for none", () => {
    expect(nextPhoto(["a"], "a", () => 0.5)).toBe("a");
    expect(nextPhoto([], undefined, () => 0.5)).toBeUndefined();
  });

  it("treats a previous photo that left the list as nothing shown", () => {
    expect(nextPhoto(["a", "b"], "gone", () => 0)).toBe("a");
  });
});

describe("CURATED_PHOTOS", () => {
  it("ships the eighteen credited photos", () => {
    expect(CURATED_PHOTOS).toHaveLength(18);
    expect(new Set(CURATED_PHOTOS).size).toBe(18);
  });
});
