import { describe, expect, it } from "vitest";
import { pinnedOrder } from "./pin-order.js";
import { restoreOptions } from "./reveal-on-restore.js";

const LEAD = ["welcome", "spec", "agent"];
const TRAIL = ["darkfactory"];

describe("the pinned tabs' order", () => {
  it("leads with Welcome, Specs and the agent, in that order, and trails with Darkfactory", () => {
    expect(pinnedOrder(["darkfactory", "a.ts", "spec", "b.ts", "welcome"], LEAD, TRAIL)).toEqual(["welcome", "spec", "a.ts", "b.ts", "darkfactory"]);
  });

  it("keeps the editors in the order they have", () => {
    expect(pinnedOrder(["c.ts", "a.ts", "b.ts"], LEAD, TRAIL)).toEqual(["c.ts", "a.ts", "b.ts"]);
  });

  it("keeps a new editor ahead of the trailing pin", () => {
    expect(pinnedOrder(["spec", "darkfactory", "new.ts"], LEAD, TRAIL)).toEqual(["spec", "new.ts", "darkfactory"]);
  });

  it("skips pins that are not in the bar", () => {
    expect(pinnedOrder(["a.ts"], LEAD, TRAIL)).toEqual(["a.ts"]);
    expect(pinnedOrder([], LEAD, TRAIL)).toEqual([]);
    expect(pinnedOrder(["darkfactory"], LEAD, TRAIL)).toEqual(["darkfactory"]);
  });

  it("is stable: its own result is a fixed point", () => {
    const once = pinnedOrder(["darkfactory", "x", "agent", "y", "welcome"], LEAD, TRAIL);
    expect(pinnedOrder(once, LEAD, TRAIL)).toEqual(once);
  });

  it("puts an id named in both lists at the front only", () => {
    expect(pinnedOrder(["a", "p"], ["p"], ["p"])).toEqual(["p", "a"]);
  });
});

describe("the options a restore opens a view with (E1)", () => {
  it("reveals a registered view, and only attaches one that asks to stay behind", () => {
    expect(restoreOptions({})).toEqual({ activate: false, reveal: true });
    expect(restoreOptions({ attachBehind: true })).toEqual({ activate: false, reveal: false });
  });
});
