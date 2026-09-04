import { describe, expect, it } from "vitest";
import {
  mosaicColumns,
  readWallLayout,
  writeWallLayout,
  MOSAIC_GAP_PX,
  MOSAIC_MIN_CELL_PX,
  WALL_LAYOUT_KEY,
  type LayoutStorage,
} from "./wall-layout.js";

function fakeStorage(initial?: string): LayoutStorage & { value: string | null } {
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

describe("readWallLayout", () => {
  it("defaults to the stack when nothing is stored", () => {
    expect(readWallLayout(fakeStorage())).toBe("stack");
  });

  it("returns the stored mosaic", () => {
    expect(readWallLayout(fakeStorage("mosaic"))).toBe("mosaic");
  });

  it("ignores an unknown value", () => {
    expect(readWallLayout(fakeStorage("grid"))).toBe("stack");
  });

  it("survives storage that throws", () => {
    const throwing: LayoutStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readWallLayout(throwing)).toBe("stack");
  });
});

describe("writeWallLayout", () => {
  it("stores the arrangement under the shared key", () => {
    const storage = fakeStorage();
    writeWallLayout(storage, "mosaic");
    expect(storage.value).toBe("mosaic");
    expect(WALL_LAYOUT_KEY).toBe("spexr.darkfactory.wallLayout");
  });

  it("swallows a storage failure", () => {
    const throwing: LayoutStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(() => writeWallLayout(throwing, "mosaic")).not.toThrow();
  });
});

describe("mosaicColumns", () => {
  it("keeps the floor at 640px per terminal", () => {
    expect(MOSAIC_MIN_CELL_PX).toBe(640);
  });

  it("splits the width between the running terminals when they all fit", () => {
    // 2000px fits three 640px cells, but only two terminals are running.
    expect(mosaicColumns(2000, 2)).toBe(2);
  });

  it("caps the columns at what the width fits, wrapping the rest", () => {
    expect(mosaicColumns(2000, 5)).toBe(3);
  });

  it("counts the gaps between cells, not just the cells", () => {
    // Two 640px cells fit 1280px alone, but not with the 16px gap between them.
    expect(mosaicColumns(1280, 2)).toBe(1);
    expect(mosaicColumns(1280 + MOSAIC_GAP_PX, 2)).toBe(2);
  });

  it("falls back to one column on a wall too narrow for the floor", () => {
    expect(mosaicColumns(500, 4)).toBe(1);
  });

  it("never returns zero columns, whatever it is given", () => {
    expect(mosaicColumns(2000, 0)).toBe(1);
    expect(mosaicColumns(0, 3)).toBe(1);
    expect(mosaicColumns(Number.NaN, 3)).toBe(1);
    expect(mosaicColumns(-100, 3)).toBe(1);
  });

  it("takes a caller-set floor, for a wall with different content", () => {
    expect(mosaicColumns(1000, 4, 320, 0)).toBe(3);
  });
});
