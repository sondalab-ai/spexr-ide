import { describe, expect, it } from "vitest";
import { EDITOR_ANCHOR_VARS, editorAnchor } from "./editor-anchor.js";

describe("the editor anchor", () => {
  it("publishes the island's left edge, its distance from the window's right edge and its width", () => {
    // The demo's main island at 1440 wide: x 328 to 1076.
    expect(editorAnchor({ left: 328, right: 1076 }, 1440)).toEqual({
      [EDITOR_ANCHOR_VARS.start]: "328px",
      [EDITOR_ANCHOR_VARS.end]: "364px",
      [EDITOR_ANCHOR_VARS.width]: "748px",
    });
  });

  it("rounds to whole pixels, so a fractional split never blurs the palette's edge", () => {
    const vars = editorAnchor({ left: 327.6, right: 1075.4 }, 1440);
    expect(vars?.[EDITOR_ANCHOR_VARS.start]).toBe("328px");
    expect(vars?.[EDITOR_ANCHOR_VARS.end]).toBe("365px");
    expect(vars?.[EDITOR_ANCHOR_VARS.width]).toBe("747px");
  });

  it("publishes nothing while the island has no width", () => {
    expect(editorAnchor({ left: 0, right: 0 }, 1440)).toBeUndefined();
    expect(editorAnchor({ left: 400, right: 400 }, 1440)).toBeUndefined();
  });
});
