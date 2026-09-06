import { describe, expect, it } from "vitest";
import { REPOSITORIES_SHARE, REVEAL_THRESHOLD, repositoriesWeights, shouldReveal } from "./scm-reveal-policy.js";

describe("shouldReveal", () => {
  it("shows the section once the workspace holds a second repository", () => {
    expect(shouldReveal(REVEAL_THRESHOLD)).toBe(true);
    expect(shouldReveal(5)).toBe(true);
  });

  it("stays hidden below the threshold, matching Theia's own default", () => {
    expect(shouldReveal(0)).toBe(false);
    expect(shouldReveal(1)).toBe(false);
  });
});

describe("repositoriesWeights", () => {
  it("gives the revealed section its share and the rest to the other part", () => {
    expect(repositoriesWeights([true, true], 0)).toEqual([REPOSITORIES_SHARE, 1 - REPOSITORIES_SHARE]);
  });

  it("splits the remainder evenly across the other participating parts", () => {
    expect(repositoriesWeights([true, true, true], 0)).toEqual([0.25, 0.375, 0.375]);
  });

  it("leaves parts that take no part in the split unweighted", () => {
    expect(repositoriesWeights([true, false, true], 0)).toEqual([
      REPOSITORIES_SHARE,
      undefined,
      1 - REPOSITORIES_SHARE,
    ]);
  });

  it("sizes a section that is not the first part", () => {
    expect(repositoriesWeights([true, true], 1)).toEqual([1 - REPOSITORIES_SHARE, REPOSITORIES_SHARE]);
  });

  it("has nothing to size when the section is the only participating part", () => {
    expect(repositoriesWeights([true, false], 0)).toEqual([undefined, undefined]);
  });

  it("has nothing to size when the section itself takes no part", () => {
    expect(repositoriesWeights([false, true], 0)).toEqual([undefined, undefined]);
  });

  it("has nothing to size for an index outside the container", () => {
    expect(repositoriesWeights([true, true], 2)).toEqual([undefined, undefined]);
    expect(repositoriesWeights([true, true], -1)).toEqual([undefined, undefined]);
  });

  it("honours a caller-supplied share", () => {
    expect(repositoriesWeights([true, true], 0, 0.2)).toEqual([0.2, 0.8]);
  });
});
