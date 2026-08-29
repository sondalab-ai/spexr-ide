import { describe, expect, it } from "vitest";
import { decideSpecPreview, type SpecPreviewState } from "./spec-preview-policy.js";

const SPEC = "file:///w/docs/specs/0014-git-hardening.md";
const OTHER_SPEC = "file:///w/docs/specs/0012-harness-adapter-slice-1.md";

const BASE: SpecPreviewState = {
  attached: false,
  anySpecOpen: false,
  wantOpen: true,
};

describe("decideSpecPreview", () => {
  it("opens the preview when a spec comes to the front", () => {
    expect(decideSpecPreview({ ...BASE, frontSpecUri: SPEC, anySpecOpen: true })).toBe("open");
  });

  it("leaves an already-attached preview alone", () => {
    expect(
      decideSpecPreview({ ...BASE, frontSpecUri: SPEC, anySpecOpen: true, attached: true }),
    ).toBe("none");
  });

  it("respects a close the user performed on this spec", () => {
    expect(
      decideSpecPreview({
        ...BASE,
        frontSpecUri: SPEC,
        anySpecOpen: true,
        wantOpen: false,
        closedForUri: SPEC,
      }),
    ).toBe("none");
  });

  it("reopens on a different spec after a close", () => {
    expect(
      decideSpecPreview({
        ...BASE,
        frontSpecUri: OTHER_SPEC,
        anySpecOpen: true,
        wantOpen: false,
        closedForUri: SPEC,
      }),
    ).toBe("open");
  });

  it("closes the preview when the last spec editor is gone, even in front", () => {
    expect(decideSpecPreview({ ...BASE, attached: true, anySpecOpen: false })).toBe("close");
  });

  it("keeps the preview while a spec editor is still open elsewhere", () => {
    expect(decideSpecPreview({ ...BASE, attached: true, anySpecOpen: true })).toBe("none");
  });

  it("does nothing when the preview is not attached and no spec is in front", () => {
    expect(decideSpecPreview(BASE)).toBe("none");
  });
});
