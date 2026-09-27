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
  it("counts a brand-new session's first turn even if it is already ended on the first reading", () => {
    const t = new TurnTracker({ settleMs: 0, armed: true });
    expect(t.update("ended", 0)).toEqual([{ type: "turn-ended" }]);
    expect(t.update("ended", 1)).toEqual([]);
  });
  it("arm() makes the next ended reading count, once", () => {
    const t = new TurnTracker({ settleMs: 0 });
    t.update("acting", 0);
    expect(t.update("ended", 1)).toEqual([{ type: "turn-ended" }]);
    expect(t.update("ended", 2)).toEqual([]);
    t.arm();
    expect(t.update("ended", 3)).toEqual([{ type: "turn-ended" }]);
    expect(t.update("ended", 4)).toEqual([]);
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
  it("keeps the reply written before an interrupt (array-wrapped marker)", () => {
    const entries = [
      user("real prompt"),
      assistant(text("partial reply")),
      { message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
    ];
    expect(finalReply(entries)).toBe("partial reply");
  });
  it("keeps the reply written before an interrupt (unwrapped marker)", () => {
    const entries = [
      user("real prompt"),
      assistant(text("partial reply")),
      { role: "user", content: "[Request interrupted by user]" },
    ] as unknown as Parameters<typeof finalReply>[0];
    expect(finalReply(entries)).toBe("partial reply");
  });
});
