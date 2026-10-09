import { describe, expect, it } from "vitest";
import { applyDelta } from "./agent-pane-apply.js";
import type { AgentPaneSnapshot } from "./agent-pane-protocol.js";

const base: AgentPaneSnapshot = {
  sessionId: "s",
  model: "claude-opus-5-5",
  state: "working",
  turn: { prompt: "go", tools: [{ id: "a", state: "run" }], prose: ["one"] },
  plan: [{ text: "x", done: false }],
  planSource: "todo",
  toolCount: 1,
};

describe("applyDelta", () => {
  it("replaces a known tool in place and appends a new one", () => {
    const next = applyDelta(base, { sessionId: "s", tools: [{ id: "a", state: "done", durationMs: 200 }, { id: "b", state: "run" }] });
    expect(next.turn!.tools).toEqual([{ id: "a", state: "done", durationMs: 200 }, { id: "b", state: "run" }]);
    expect(next.turn!.prompt).toBe("go");
  });

  it("replaces the fields it carries and keeps the rest", () => {
    const next = applyDelta(base, { sessionId: "s", state: "idle", needsYou: true, toolCount: 2, plan: [{ text: "x", done: true }], planSource: "task", prose: ["two"] });
    expect(next).toMatchObject({ state: "idle", needsYou: true, toolCount: 2, planSource: "task", model: "claude-opus-5-5" });
    expect(next.plan).toEqual([{ text: "x", done: true }]);
    expect(next.turn!.prose).toEqual(["two"]);
    expect(next.turn!.tools).toEqual(base.turn!.tools);
  });

  it("ignores a delta for another session, and does not mutate", () => {
    expect(applyDelta(base, { sessionId: "other", state: "idle" })).toBe(base);
    applyDelta(base, { sessionId: "s", tools: [{ id: "z", state: "run" }] });
    expect(base.turn!.tools).toHaveLength(1);
  });

  it("builds a turn from nothing", () => {
    const next = applyDelta({ sessionId: "s" }, { sessionId: "s", tools: [{ id: "a", state: "run" }], diff: { file: "x.ts" } });
    expect(next.turn).toEqual({ tools: [{ id: "a", state: "run" }], diff: { file: "x.ts" } });
  });
});
