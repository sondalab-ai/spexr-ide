import { describe, expect, it } from "vitest";
import { formatPullOutcome } from "./pull-outcome-format.js";

describe("formatPullOutcome", () => {
  it("distinguishes a pull that brought nothing", () => {
    expect(formatPullOutcome({ changedFiles: 0, insertions: 0, deletions: 0 })).toBe(
      "Already up to date.",
    );
  });

  it("reports what a pull actually changed", () => {
    expect(formatPullOutcome({ changedFiles: 3, insertions: 42, deletions: 7 })).toBe(
      "Pulled 3 files (+42 -7).",
    );
    expect(formatPullOutcome({ changedFiles: 1, insertions: 2, deletions: 0 })).toBe(
      "Pulled 1 file (+2 -0).",
    );
  });

  it("says nothing misleading when there is no repository to have pulled", () => {
    expect(formatPullOutcome(undefined)).toBe("Already up to date.");
  });
});
