import { describe, expect, it } from "vitest";
import { ISLAND_GAP } from "./islands.js";
import {
  MIN_LEFT_ISLAND_WIDTH,
  MIN_LEFT_PANEL_SIZE,
  MIN_RIGHT_ISLAND_WIDTH,
  MIN_RIGHT_PANEL_SIZE,
  expandLeftPanelWithMinWidth,
  expandRightPanelWithMinWidth,
  expandSidePanel,
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

// Theia measures a side from the window's edge to its split handle, so a
// floor on the island is asked for with the chrome around it: the activity
// bar's column (52 + the 6px gap) on both sides, and the handle on the right.
// A 400px floor once left a 394px panel because the handle was not counted.
describe("the right panel's floor", () => {
  it("is Lumen's 352px island, with the handle and the activity column Theia's measure includes", () => {
    expect(MIN_RIGHT_ISLAND_WIDTH).toBe(352);
    expect(MIN_RIGHT_PANEL_SIZE).toBe(ISLAND_GAP + 352 + 52 + ISLAND_GAP);
  });

  it("resizes a narrower panel to the floor", async () => {
    const calls: string[] = [];
    await expandRightPanelWithMinWidth(shellWith("right", MIN_RIGHT_PANEL_SIZE - 1, calls));
    expect(calls).toEqual(["expand", `resize:${MIN_RIGHT_PANEL_SIZE}`]);
  });

  it("leaves a panel already at the floor alone", async () => {
    const calls: string[] = [];
    await expandRightPanelWithMinWidth(shellWith("right", MIN_RIGHT_PANEL_SIZE, calls));
    expect(calls).toEqual(["expand"]);
  });
});

describe("the left panel's floor", () => {
  it("keeps the agent terminal's 432px island, with the activity column", async () => {
    expect(MIN_LEFT_ISLAND_WIDTH).toBe(432);
    expect(MIN_LEFT_PANEL_SIZE).toBe(52 + ISLAND_GAP + 432);
    const calls: string[] = [];
    await expandLeftPanelWithMinWidth(shellWith("left", MIN_LEFT_PANEL_SIZE - 1, calls));
    expect(calls).toEqual(["expand", `resize:${MIN_LEFT_PANEL_SIZE}`]);
  });
});

// The layout contribution opens the left panel on every launch, and must not
// floor it: a restored width stays the user's, a first launch takes Lumen's.
describe("expanding a side with no floor", () => {
  it("expands and never resizes, however narrow the panel", async () => {
    const calls: string[] = [];
    await expandSidePanel(shellWith("left", 100, calls), "left");
    expect(calls).toEqual(["expand"]);
  });
});
