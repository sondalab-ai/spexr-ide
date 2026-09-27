import { describe, expect, it } from "vitest";
import { TurnTracker, finalReply } from "./turn-tracker.js";

describe("TurnTracker", () => {
  it("reports a turn end only after it has seen the agent working", () => {
    const t = new TurnTracker({ settleMs: 2_000 });
    expect(t.update("ended", 0)).toEqual([]); // nothing seen working yet: a stale end
    expect(t.update("acting", 1)).toEqual([]);
    expect(t.update("ended", 2)).toEqual([{ type: "turn-ended" }]);
  });
  it("does not report the same ended turn twice", () => {
    const t = new TurnTracker({ settleMs: 2_000 });
    t.update("acting", 0);
    t.update("ended", 1);
    expect(t.update("ended", 2)).toEqual([]);
    expect(t.update("ended", 3_000)).toEqual([]);
  });
  it("reports needs-you once a permission prompt has settled, and the resume after it", () => {
    const t = new TurnTracker({ settleMs: 2_000 });
    t.update("acting", 0);
    expect(t.update("permission", 1_000)).toEqual([]);
    expect(t.update("permission", 3_000)).toEqual([{ type: "needs-you" }]);
    expect(t.update("permission", 4_000)).toEqual([]);
    expect(t.update("acting", 5_000)).toEqual([{ type: "resumed-working" }]);
  });
  it("treats a pending tool as work under an auto-approving mode", () => {
    const t = new TurnTracker({ settleMs: 0, permissionMode: "bypassPermissions" });
    expect(t.update("permission", 0)).toEqual([]);
    expect(t.update("ended", 1)).toEqual([{ type: "turn-ended" }]);
  });
  it("closes a permission wait that ends the turn", () => {
    const t = new TurnTracker({ settleMs: 0 });
    expect(t.update("permission", 0)).toEqual([{ type: "needs-you" }]); // settleMs 0: confirmed at once
    expect(t.update("ended", 1)).toEqual([{ type: "resumed-working" }, { type: "turn-ended" }]);
  });
});

const user = (content: unknown) => ({ message: { role: "user", content } });
const assistant = (...content: unknown[]) => ({ message: { role: "assistant", content } });
const text = (t: string) => ({ type: "text", text: t });

describe("finalReply", () => {
  it("joins the whole last turn, across assistant entries and tool calls", () => {
    const entries = [
      user("first prompt"),
      assistant(text("old reply")),
      user("second prompt"),
      assistant(text("Looking."), { type: "tool_use", name: "Read", input: {} }),
      user([{ type: "tool_result", content: "file" }]),
      assistant(text("Fixed it.")),
      assistant(text("CONVERGED")),
    ];
    expect(finalReply(entries)).toBe("Looking.\n\nFixed it.\n\nCONVERGED");
  });
  it("ignores meta entries and returns empty without a reply", () => {
    expect(finalReply([user("p"), { isMeta: true, message: { role: "user", content: "x" } }])).toBe("");
  });
});
