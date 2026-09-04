import { describe, expect, it } from "vitest";
import {
  clampPinnedHeight,
  readPinnedHeight,
  writePinnedHeight,
  pinnedHeightKey,
  PINNED_HEIGHT_KEY,
  type HeightStorage,
} from "./pinned-card-height.js";

const VIEWPORT = 1000; // 20vh = 200px, 90vh = 900px

/** Key-aware fake: the two arrangements must not share a stored height. */
function fakeStorage(initial?: Record<string, string>): HeightStorage & {
  values: Record<string, string>;
} {
  return {
    values: { ...initial },
    getItem(key: string) {
      return this.values[key] ?? null;
    },
    setItem(key: string, v: string) {
      this.values[key] = v;
    },
  };
}

/** A store holding `value` for the stacked card only. */
function stacked(value: string): Record<string, string> {
  return { [PINNED_HEIGHT_KEY]: value };
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
    expect(readPinnedHeight(fakeStorage(), VIEWPORT, "stack")).toBeUndefined();
  });

  it("returns the stored height", () => {
    expect(readPinnedHeight(fakeStorage(stacked("420")), VIEWPORT, "stack")).toBe(420);
  });

  it("clamps a stored height that no longer fits the viewport", () => {
    expect(readPinnedHeight(fakeStorage(stacked("700")), 500, "stack")).toBe(450);
  });

  it("ignores a non-numeric value", () => {
    expect(readPinnedHeight(fakeStorage(stacked("tall")), VIEWPORT, "stack")).toBeUndefined();
  });

  it("ignores a non-positive value", () => {
    expect(readPinnedHeight(fakeStorage(stacked("0")), VIEWPORT, "stack")).toBeUndefined();
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
    expect(readPinnedHeight(throwing, VIEWPORT, "stack")).toBeUndefined();
  });
});

describe("writePinnedHeight", () => {
  it("stores a rounded height under the stacked key", () => {
    const storage = fakeStorage();
    writePinnedHeight(storage, 512.7, "stack");
    expect(storage.values[PINNED_HEIGHT_KEY]).toBe("513");
    expect(PINNED_HEIGHT_KEY).toBe("spexr.darkfactory.pinnedHeight");
  });

  it("keeps the mosaic height apart from the stacked one", () => {
    const storage = fakeStorage(stacked("800"));
    writePinnedHeight(storage, 300, "mosaic");
    expect(readPinnedHeight(storage, VIEWPORT, "stack")).toBe(800);
    expect(readPinnedHeight(storage, VIEWPORT, "mosaic")).toBe(300);
    expect(pinnedHeightKey("mosaic")).toBe("spexr.darkfactory.pinnedHeight.mosaic");
  });

  it("swallows a storage failure", () => {
    const throwing: HeightStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(() => writePinnedHeight(throwing, 400, "stack")).not.toThrow();
  });
});
