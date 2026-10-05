import { describe, expect, it } from "vitest";
import { ISLAND_GAP } from "./islands.js";
import {
  MIN_LEFT_PANEL_WIDTH,
  MIN_RIGHT_PANEL_SIZE,
  MIN_RIGHT_PANEL_WIDTH,
  expandLeftPanelWithMinWidth,
  expandRightPanelWithMinWidth,
  type SidePanelShell,
} from "./side-panel.js";

/** A side handler that records its calls and reports `size` as Theia's measure. */
function handler(size: number | undefined, calls: string[]) {
  return {
    expand: () => calls.push("expand"),
    resize: (to: number) => calls.push(`resize:${to}`),
    getPanelSize: () => size,
    state: { pendingUpdate: Promise.resolve() },
  };
}

function shellWith(side: "left" | "right", size: number | undefined, calls: string[]): SidePanelShell {
  const h = handler(size, calls);
  return side === "left" ? { leftPanelHandler: h, rightPanelHandler: undefined } : { leftPanelHandler: undefined, rightPanelHandler: h };
}

// Theia measures the right panel from its split handle's offset, so its size
// includes the handle, the island gap: a 400px floor left a 394px panel.
describe("the right panel's floor", () => {
  it("counts the island gap Theia's measure includes", () => {
    expect(MIN_RIGHT_PANEL_SIZE).toBe(MIN_RIGHT_PANEL_WIDTH + ISLAND_GAP);
  });

  it("resizes a narrower panel to the floor plus the gap", async () => {
    const calls: string[] = [];
    await expandRightPanelWithMinWidth(shellWith("right", MIN_RIGHT_PANEL_WIDTH, calls));
    expect(calls).toEqual(["expand", `resize:${MIN_RIGHT_PANEL_WIDTH + ISLAND_GAP}`]);
  });

  it("leaves a panel already at the floor alone", async () => {
    const calls: string[] = [];
    await expandRightPanelWithMinWidth(shellWith("right", MIN_RIGHT_PANEL_SIZE, calls));
    expect(calls).toEqual(["expand"]);
  });
});

// The left panel's size is its handle's offset itself: no gap in it.
describe("the left panel's floor", () => {
  it("is the panel's own width", async () => {
    const calls: string[] = [];
    await expandLeftPanelWithMinWidth(shellWith("left", MIN_LEFT_PANEL_WIDTH - 1, calls));
    expect(calls).toEqual(["expand", `resize:${MIN_LEFT_PANEL_WIDTH}`]);
  });
});
