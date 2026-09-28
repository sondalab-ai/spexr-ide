import { describe, expect, it } from "vitest";
import { squareFor } from "./photo-geometry.js";

describe("squareFor", () => {
  it("anchors a square of half the longer side to the bottom-right of a wide host", () => {
    expect(squareFor(1600, 900)).toEqual({ side: 800, left: 800, top: 100 });
  });

  it("does the same on a tall host", () => {
    expect(squareFor(600, 1000)).toEqual({ side: 500, left: 100, top: 500 });
  });

  it("covers a quarter of a square host", () => {
    expect(squareFor(800, 800)).toEqual({ side: 400, left: 400, top: 400 });
  });

  it("lets the square rise above a host shorter than half its width", () => {
    expect(squareFor(1600, 500)).toEqual({ side: 800, left: 800, top: -300 });
  });

  it("rounds to whole pixels and draws nothing on an empty host", () => {
    expect(squareFor(1001, 400)).toEqual({ side: 501, left: 500, top: -101 });
    expect(squareFor(0, 0)).toEqual({ side: 0, left: 0, top: 0 });
  });
});
