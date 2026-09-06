import { describe, expect, it } from "vitest";
import { SHARE_SLACK, exceedsShare, partShareWeights } from "./part-share.js";

describe("exceedsShare", () => {
  it("is over when the section takes more than its share plus the slack", () => {
    expect(exceedsShare(500, 1000, 0.25)).toBe(true);
  });

  it("is not over at exactly its share", () => {
    expect(exceedsShare(250, 1000, 0.25)).toBe(false);
  });

  it("absorbs rounding around the share", () => {
    expect(exceedsShare(250 + SHARE_SLACK * 1000 - 1, 1000, 0.25)).toBe(false);
    expect(exceedsShare(250 + SHARE_SLACK * 1000 + 1, 1000, 0.25)).toBe(true);
  });

  it("is over for a section at the third of the panel a restored layout can hold", () => {
    // The size a saved layout records is already header-corrected, so it is
    // directly comparable: a third of the container is over a quarter cap.
    expect(exceedsShare(319, 1000, 0.25)).toBe(true);
  });

  it("treats a section with no size of its own as over", () => {
    expect(exceedsShare(undefined, 1000, 0.25)).toBe(true);
    expect(exceedsShare(0, 1000, 0.25)).toBe(true);
  });

  it("decides nothing about a container that has not been laid out", () => {
    expect(exceedsShare(undefined, 0, 0.25)).toBe(false);
    expect(exceedsShare(500, 0, 0.25)).toBe(false);
  });

  it("honours a caller-supplied slack", () => {
    expect(exceedsShare(300, 1000, 0.25, 0.1)).toBe(false);
    expect(exceedsShare(300, 1000, 0.25, 0.01)).toBe(true);
  });
});

describe("partShareWeights", () => {
  it("gives the capped section its share and the rest to the other part", () => {
    expect(partShareWeights([true, true], 0, 0.25)).toEqual([0.25, 0.75]);
  });

  it("splits the remainder evenly across the other participating parts", () => {
    expect(partShareWeights([true, true, true], 0, 0.25)).toEqual([0.25, 0.375, 0.375]);
  });

  it("leaves parts that take no part in the split unweighted", () => {
    expect(partShareWeights([true, false, true], 0, 0.25)).toEqual([0.25, undefined, 0.75]);
  });

  it("sizes a section that is not the first part", () => {
    expect(partShareWeights([true, true], 1, 0.25)).toEqual([0.75, 0.25]);
  });

  it("has nothing to size when the section is the only participating part", () => {
    expect(partShareWeights([true, false], 0, 0.25)).toEqual([undefined, undefined]);
  });

  it("has nothing to size when the section itself takes no part", () => {
    expect(partShareWeights([false, true], 0, 0.25)).toEqual([undefined, undefined]);
  });

  it("has nothing to size for an index outside the container", () => {
    expect(partShareWeights([true, true], 2, 0.25)).toEqual([undefined, undefined]);
    expect(partShareWeights([true, true], -1, 0.25)).toEqual([undefined, undefined]);
  });
});
