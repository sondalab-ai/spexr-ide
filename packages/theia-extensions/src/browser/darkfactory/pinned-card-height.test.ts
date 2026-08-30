import { describe, expect, it } from "vitest";
import {
  clampPinnedHeight,
  readPinnedHeight,
  writePinnedHeight,
  PINNED_HEIGHT_KEY,
  type HeightStorage,
} from "./pinned-card-height.js";

const VIEWPORT = 1000; // 20vh = 200px, 90vh = 900px

function fakeStorage(initial?: string): HeightStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, v: string) {
      this.value = v;
    },
  };
}

describe("clampPinnedHeight", () => {
  it("leaves a height inside the bounds alone", () => {
    expect(clampPinnedHeight(500, VIEWPORT)).toBe(500);
  });

  it("lifts a height below the floor", () => {
    expect(clampPinnedHeight(10, VIEWPORT)).toBe(200);
  });

  it("caps a height above the ceiling", () => {
    expect(clampPinnedHeight(5000, VIEWPORT)).toBe(900);
  });

  it("rounds to whole pixels", () => {
    expect(clampPinnedHeight(500.4, VIEWPORT)).toBe(500);
  });

  it("re-derives the bounds from the viewport it is given", () => {
    // 700px fitted a tall window; on a short one it must come down to 90vh.
    expect(clampPinnedHeight(700, 500)).toBe(450);
  });
});

describe("readPinnedHeight", () => {
  it("returns nothing when no height was stored", () => {
    expect(readPinnedHeight(fakeStorage(), VIEWPORT)).toBeUndefined();
  });

  it("returns the stored height", () => {
    expect(readPinnedHeight(fakeStorage("420"), VIEWPORT)).toBe(420);
  });

  it("clamps a stored height that no longer fits the viewport", () => {
    expect(readPinnedHeight(fakeStorage("700"), 500)).toBe(450);
  });

  it("ignores a non-numeric value", () => {
    expect(readPinnedHeight(fakeStorage("tall"), VIEWPORT)).toBeUndefined();
  });

  it("ignores a non-positive value", () => {
    expect(readPinnedHeight(fakeStorage("0"), VIEWPORT)).toBeUndefined();
  });

  it("survives storage that throws", () => {
    const throwing: HeightStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readPinnedHeight(throwing, VIEWPORT)).toBeUndefined();
  });
});

describe("writePinnedHeight", () => {
  it("stores a rounded height under the shared key", () => {
    const storage = fakeStorage();
    writePinnedHeight(storage, 512.7);
    expect(storage.value).toBe("513");
    expect(PINNED_HEIGHT_KEY).toBe("spexr.darkfactory.pinnedHeight");
  });

  it("swallows a storage failure", () => {
    const throwing: HeightStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(() => writePinnedHeight(throwing, 400)).not.toThrow();
  });
});
