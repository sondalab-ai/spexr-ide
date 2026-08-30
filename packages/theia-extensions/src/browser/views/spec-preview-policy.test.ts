import { describe, expect, it } from "vitest";
import { decideSpecPreview, type SpecPreviewState } from "./spec-preview-policy.js";

const SPEC = "file:///w/docs/specs/0014-git-hardening.md";
const OTHER_SPEC = "file:///w/docs/specs/0012-harness-adapter-slice-1.md";

const BASE: SpecPreviewState = {
  attached: false,
  anyMarkdownOpen: false,
  wantOpen: true,
};

describe("decideSpecPreview", () => {
  it("opens the preview when a spec comes to the front", () => {
    expect(decideSpecPreview({ ...BASE, frontSpecUri: SPEC, anyMarkdownOpen: true })).toBe("open");
  });

  it("leaves an already-attached preview alone", () => {
    expect(
      decideSpecPreview({ ...BASE, frontSpecUri: SPEC, anyMarkdownOpen: true, attached: true }),
    ).toBe("none");
  });

  it("respects a close the user performed on this spec", () => {
    expect(
      decideSpecPreview({
        ...BASE,
        frontSpecUri: SPEC,
        anyMarkdownOpen: true,
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
        anyMarkdownOpen: true,
        wantOpen: false,
        closedForUri: SPEC,
      }),
    ).toBe("open");
  });

  it("closes the preview when the last markdown editor is gone, even in front", () => {
    expect(decideSpecPreview({ ...BASE, attached: true, anyMarkdownOpen: false })).toBe("close");
  });

  it("keeps the preview while a markdown editor is still open elsewhere", () => {
    expect(decideSpecPreview({ ...BASE, attached: true, anyMarkdownOpen: true })).toBe("none");
  });

  it("keeps a hand-opened preview alive over a non-spec markdown file", () => {
    // No spec in front, so nothing auto-opens; the open README is what keeps it.
    expect(
      decideSpecPreview({ ...BASE, attached: true, anyMarkdownOpen: true, wantOpen: true }),
    ).toBe("none");
  });

  it("does not auto-open on a non-spec markdown file", () => {
    // frontSpecUri stays undefined for a README: only specs bring the preview up.
    expect(decideSpecPreview({ ...BASE, anyMarkdownOpen: true })).toBe("none");
  });

  it("does nothing when the preview is not attached and no spec is in front", () => {
    expect(decideSpecPreview(BASE)).toBe("none");
  });
});
