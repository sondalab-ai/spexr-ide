import { describe, expect, it } from "vitest";
import { EDITOR_ANCHOR_VARS, editorAnchor, publishEditorAnchor, trackEditorAnchor, type AnchorRoot, type AnchorWindow } from "./editor-anchor.js";

const fakeRoot = (): AnchorRoot & { vars: Map<string, string> } => {
  const vars = new Map<string, string>();
  return {
    vars,
    style: {
      setProperty: (name, value) => void vars.set(name, value),
      removeProperty: (name) => (vars.delete(name) ? "" : ""),
    },
  };
};

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

  it("has nothing to publish while the island has no width", () => {
    expect(editorAnchor({ left: 0, right: 0 }, 1440)).toBeUndefined();
    expect(editorAnchor({ left: 400, right: 400 }, 1440)).toBeUndefined();
  });

  it("removes what it published when the island goes to zero width, so nothing stale is left", () => {
    const root = fakeRoot();
    publishEditorAnchor(root, { left: 328, right: 1076 }, 1440);
    expect(root.vars.size).toBe(3);
    publishEditorAnchor(root, { left: 0, right: 0 }, 1440);
    expect(root.vars.size).toBe(0);
  });
});

describe("tracking the editor anchor", () => {
  /** A window whose observers can be fired by hand, and whose disconnects are counted. */
  function fakeWindow(): { win: AnchorWindow; fire(): void; observed: unknown[]; disconnected: () => number } {
    const callbacks: Array<() => void> = [];
    const observed: unknown[] = [];
    let disconnects = 0;
    class FakeObserver {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(target: unknown): void {
        observed.push(target);
      }
      disconnect(): void {
        disconnects++;
      }
    }
    return { win: { innerWidth: 1440, ResizeObserver: FakeObserver }, fire: () => callbacks.forEach((c) => c()), observed, disconnected: () => disconnects };
  }

  it("publishes now, follows the island and the sides, and stops when disposed", () => {
    const root = fakeRoot();
    const { win, fire, observed, disconnected } = fakeWindow();
    let box = { left: 328, right: 1076 };
    const main = { getBoundingClientRect: () => box };
    const side = {};
    const tracking = trackEditorAnchor(root, win, main, [side]);
    expect(observed).toEqual([main, side]);
    expect(root.vars.get(EDITOR_ANCHOR_VARS.start)).toBe("328px");
    box = { left: 400, right: 1000 };
    fire();
    expect(root.vars.get(EDITOR_ANCHOR_VARS.width)).toBe("600px");
    box = { left: 0, right: 0 };
    fire();
    expect(root.vars.size).toBe(0);
    tracking.dispose();
    expect(disconnected()).toBe(1);
  });
});
