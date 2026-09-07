import { describe, expect, it } from "vitest";
import { explainCheckoutFailure } from "./checkout-failure.js";

describe("explainCheckoutFailure", () => {
  it("translates the colliding-changes refusal", () => {
    const raw =
      "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts";
    expect(explainCheckoutFailure(raw)).toBe(
      "Checkout blocked — the target branch changes files you have uncommitted edits in. Commit or stash them first.",
    );
  });

  it("translates the unresolved-merge refusal", () => {
    expect(explainCheckoutFailure("error: you need to resolve your current index first")).toBe(
      "Checkout blocked — conclude or abort the merge in progress first.",
    );
  });

  it("leaves anything it does not recognise to git's own words", () => {
    expect(explainCheckoutFailure("fatal: invalid reference: nope")).toBeUndefined();
  });
});
