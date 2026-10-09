import { describe, expect, it } from "vitest";
import type { AgentPaneCheckpoint, PanePhase } from "../../common/agent-pane-protocol.js";
import { guardedPlanToggle, guardedSend, type GuardPorts } from "./agent-pane-guard.js";

type Call = string;

/** A scripted agent terminal: what it was asked to do, and what its transcript says at each read. */
function fake(over: Partial<GuardPorts> & { phases?: Array<PanePhase | undefined> } = {}): { ports: GuardPorts; calls: Call[] } {
  const calls: Call[] = [];
  const phases = [...(over.phases ?? [])];
  const ports: GuardPorts = {
    trusted: async () => true,
    running: () => true,
    start: async () => void calls.push("start"),
    checkpoint: async (): Promise<AgentPaneCheckpoint | undefined> => {
      calls.push("checkpoint");
      const phase = phases.length ? phases.shift() : "ready";
      return { sessionId: "s", ...(phase ? { phase } : {}) };
    },
    paste: (t) => void calls.push(`paste:${t}`),
    submit: () => void calls.push("submit"),
    cycleMode: () => void calls.push("cycle"),
    sleep: async () => undefined,
    ...over,
  };
  return { ports, calls };
}

describe("guardedSend", () => {
  it("types the text and submits it only when the session is idle before and after the text is in", async () => {
    const { ports, calls } = fake({ phases: ["ready", "ready"] });
    expect(await guardedSend("hello", ports)).toBe("sent");
    expect(calls).toEqual(["checkpoint", "paste:hello", "checkpoint", "submit"]);
  });

  it("types nothing while the agent is working", async () => {
    const { ports, calls } = fake({ phases: ["working"] });
    expect(await guardedSend("hello", ports)).toBe("busy");
    expect(calls).toEqual(["checkpoint"]);
  });

  it("types nothing while a permission may be pending (an open call that asks), and never presses Enter", async () => {
    const { ports, calls } = fake({ phases: ["permission"] });
    expect(await guardedSend("hello", ports)).toBe("busy");
    expect(calls).not.toContain("submit");
    expect(calls.some((c) => c.startsWith("paste"))).toBe(false);
  });

  it("types nothing when the transcript cannot be read, or says nothing yet", async () => {
    expect(await guardedSend("hello", fake({ checkpoint: async () => undefined }).ports)).toBe("busy");
    expect(await guardedSend("hello", fake({ phases: [undefined] }).ports)).toBe("busy");
  });

  it("does not press Enter when the session leaves its prompt after the text is typed (a permission dialog raised in between), and leaves the text in the TUI", async () => {
    const { ports, calls } = fake({ phases: ["ready", "permission"] });
    expect(await guardedSend("hello", ports)).toBe("raced");
    expect(calls).toEqual(["checkpoint", "paste:hello", "checkpoint"]);
    expect(calls).not.toContain("submit");
  });

  it("does not press Enter when the turn reopened (working) after the paste", async () => {
    const { ports, calls } = fake({ phases: ["ready", "working"] });
    expect(await guardedSend("hello", ports)).toBe("raced");
    expect(calls).not.toContain("submit");
  });

  it("launches nothing and types nothing in an untrusted workspace", async () => {
    for (const running of [true, false]) {
      const { ports, calls } = fake({ trusted: async () => false, running: () => running });
      expect(await guardedSend("hello", ports)).toBe("untrusted");
      expect(calls).toEqual([]);
    }
  });

  it("only starts the agent when none runs: nothing is typed into a first launch, which may open Claude's own dialogs", async () => {
    const { ports, calls } = fake({ running: () => false });
    expect(await guardedSend("hello", ports)).toBe("started");
    expect(calls).toEqual(["start"]);
  });
});

/**
 * A TUI whose Shift+Tab walks a cycle, writing the new mode to the transcript:
 * the checkpoint after a press says the next mode.
 */
function cycling(cycle: string[], start: string, over: { phase?: PanePhase; silent?: boolean } = {}): { ports: GuardPorts; modes: string[]; calls: Call[] } {
  const modes = [start];
  const calls: Call[] = [];
  let at = cycle.indexOf(start);
  const ports: GuardPorts = {
    trusted: async () => true,
    running: () => true,
    start: async () => undefined,
    checkpoint: async () => ({ sessionId: "s", phase: over.phase ?? "ready", permissionMode: modes[modes.length - 1]! }),
    paste: () => void calls.push("paste"),
    submit: () => void calls.push("submit"),
    cycleMode: () => {
      calls.push("cycle");
      if (over.silent) return;
      at = (at + 1) % cycle.length;
      modes.push(cycle[at]!);
    },
    sleep: async () => undefined,
  };
  return { ports, modes, calls };
}

describe("guardedPlanToggle", () => {
  const CYCLE = ["default", "acceptEdits", "plan"];

  it("enters plan from the default mode, one press at a time, reading the mode back after each", async () => {
    const t = cycling(CYCLE, "default");
    expect(await guardedPlanToggle(t.ports)).toEqual({ ok: true, mode: "plan" });
    expect(t.calls).toEqual(["cycle", "cycle"]);
    expect(t.modes).toEqual(["default", "acceptEdits", "plan"]);
  });

  it("leaves plan for the default mode, going on past a mode that does not ask", async () => {
    const t = cycling(["default", "acceptEdits", "plan", "auto"], "plan");
    expect(await guardedPlanToggle(t.ports)).toEqual({ ok: true, mode: "default" });
    expect(t.modes[t.modes.length - 1]).toBe("default");
    expect(t.modes).toEqual(["plan", "auto", "default"]);
  });

  it.each([
    [["default", "acceptEdits", "plan"], "default"],
    [["default", "acceptEdits", "plan"], "acceptEdits"],
    [["default", "acceptEdits", "plan"], "plan"],
    [["default", "acceptEdits", "plan", "auto"], "default"],
    [["default", "acceptEdits", "plan", "auto"], "auto"],
    [["default", "acceptEdits", "plan", "bypassPermissions"], "bypassPermissions"],
    [["default", "acceptEdits", "plan", "bypassPermissions", "auto"], "plan"],
  ])("never ends in a mode that does not ask, from %j starting at %s", async (cycle, start) => {
    const t = cycling(cycle, start);
    const outcome = await guardedPlanToggle(t.ports);
    expect(outcome.ok).toBe(true);
    expect(["plan", "default"]).toContain(t.modes[t.modes.length - 1]);
  });

  it("presses nothing while the agent is working or a permission is pending", async () => {
    for (const phase of ["working", "permission"] as const) {
      const t = cycling(CYCLE, "default", { phase });
      expect(await guardedPlanToggle(t.ports)).toMatchObject({ ok: false, reason: "busy" });
      expect(t.calls).toEqual([]);
    }
  });

  it("stops, and says the mode is unconfirmed, when a press never shows in the transcript", async () => {
    const t = cycling(CYCLE, "default", { silent: true });
    const outcome = await guardedPlanToggle({ ...t.ports, sleep: async () => new Promise((r) => setTimeout(r, 1500)) });
    expect(outcome).toMatchObject({ ok: false, reason: "unconfirmed", mode: "default", unsafe: false });
    expect(t.calls).toEqual(["cycle"]);
  });

  it("stops and reports an unsafe mode when the cycle never reaches the wanted one", async () => {
    const t = cycling(["acceptEdits", "auto"], "acceptEdits");
    const outcome = await guardedPlanToggle(t.ports);
    expect(outcome).toMatchObject({ ok: false, reason: "no-way", unsafe: true });
    expect(t.calls.length).toBeLessThanOrEqual(6);
  });

  it("presses nothing in an untrusted workspace or with no agent running", async () => {
    const t = cycling(CYCLE, "default");
    expect(await guardedPlanToggle({ ...t.ports, trusted: async () => false })).toEqual({ ok: false, reason: "untrusted" });
    expect(await guardedPlanToggle({ ...t.ports, running: () => false })).toEqual({ ok: false, reason: "not-running" });
    expect(t.calls).toEqual([]);
  });
});
