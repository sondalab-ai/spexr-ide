import { describe, expect, test } from "vitest";
import { asksUser, classifySession, lastTurn } from "./session-state.js";

const NOW = 1_000_000_000_000;
const LIVE = new Set(["/p"]);

const userMsg = [{ message: { role: "user", content: "go" } }];
const toolUse = (name: string) => [
  { message: { role: "assistant", content: [{ type: "text", text: "…" }, { type: "tool_use", name }] } },
];
const endedTurn = [{ message: { role: "assistant", content: [{ type: "text", text: "done" }] } }];

describe("classifySession — live sessions are working or needs-you, never idle", () => {
  test("working: turn is acting (last entry a user message)", () => {
    expect(classifySession("/p", NOW - 10_000, true, LIVE, NOW, userMsg)).toEqual({
      state: "working",
      needsYou: false,
      needsYouCertain: false,
    });
  });

  test("working: a non-permission tool is running", () => {
    expect(classifySession("/p", NOW - 10_000, true, LIVE, NOW, toolUse("Read")).state).toBe("working");
  });

  test("working stays through a several-minute gap (a long tool/inference)", () => {
    expect(classifySession("/p", NOW - 5 * 60_000, true, LIVE, NOW, userMsg).state).toBe("working");
  });

  test("dormant: a live process with no write for >10min is idle, not working (no zombie pulse)", () => {
    expect(classifySession("/p", NOW - 30 * 60_000, true, LIVE, NOW, userMsg)).toEqual({
      state: "idle",
      needsYou: false,
      needsYouCertain: false,
    });
  });

  test("needs-you (certain): a permission tool has stalled under default mode", () => {
    expect(classifySession("/p", NOW - 4_000, true, LIVE, NOW, toolUse("Bash"), "default")).toEqual({
      state: "idle",
      needsYou: true,
      needsYouCertain: true,
    });
  });

  test("working: a stalled permission tool under auto-approve mode is not a prompt", () => {
    expect(classifySession("/p", NOW - 4_000, true, LIVE, NOW, toolUse("Bash"), "auto")).toEqual({
      state: "working",
      needsYou: false,
      needsYouCertain: false,
    });
  });

  test("working: a permission tool that has not yet settled is still running", () => {
    expect(classifySession("/p", NOW - 500, true, LIVE, NOW, toolUse("Bash")).needsYou).toBe(false);
  });

  test("needs-you (uncertain): the assistant ended its turn", () => {
    expect(classifySession("/p", NOW - 4_000, true, LIVE, NOW, endedTurn)).toEqual({
      state: "idle",
      needsYou: true,
      needsYouCertain: false,
    });
  });

  test("trailing meta entries are skipped when reading the turn", () => {
    const withMeta = [...endedTurn, { isMeta: true, message: { role: "user", content: "<reminder>" } }];
    expect(classifySession("/p", NOW - 4_000, true, LIVE, NOW, withMeta).needsYou).toBe(true);
  });

  test("a finished turn is not 'working' despite trailing metadata records", () => {
    // Claude Code appends typed metadata (no message) after the closing reply.
    const withMeta = [
      ...endedTurn,
      { type: "last-prompt" },
      { type: "ai-title" },
      { type: "mode" },
      { type: "permission-mode" },
    ] as { message?: { role?: string; content?: unknown }; isMeta?: boolean }[];
    expect(classifySession("/p", NOW - 4_000, true, LIVE, NOW, withMeta)).toEqual({
      state: "idle",
      needsYou: true,
      needsYouCertain: false,
    });
  });

  test("working: a still-streaming assistant message (last block thinking)", () => {
    const streaming = [{ message: { role: "assistant", content: [{ type: "thinking", text: "…" }] } }];
    expect(classifySession("/p", NOW - 3_000, true, LIVE, NOW, streaming).state).toBe("working");
  });

  test("needs-you: ESC interrupt after a tool — Claude's unwrapped marker shape", () => {
    const interrupted = [
      ...toolUse("Bash"),
      { type: "queue-operation", content: "undefined" },
      { type: "user", role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
    ] as unknown as Parameters<typeof classifySession>[5];
    expect(classifySession("/p", NOW - 2_000, true, LIVE, NOW, interrupted)).toEqual({
      state: "idle",
      needsYou: true,
      needsYouCertain: false,
    });
  });

  test("needs-you: ESC interrupt in the normalized message shape (other harness)", () => {
    const interrupted = [
      ...toolUse("Edit"),
      { message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
    ];
    expect(classifySession("/p", NOW - 2_000, true, LIVE, NOW, interrupted).needsYou).toBe(true);
  });

  test("working: a new prompt after the interrupt marker resumes the session", () => {
    const resumed = [
      ...toolUse("Bash"),
      { type: "user", role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] },
      { message: { role: "user", content: "carry on" } },
    ] as unknown as Parameters<typeof classifySession>[5];
    expect(classifySession("/p", NOW - 2_000, true, LIVE, NOW, resumed).state).toBe("working");
  });
});

describe("classifySession — no live process", () => {
  test("idle: recent write, no live process (paused session)", () => {
    expect(classifySession("/p", NOW - 10_000, true, new Set(), NOW, userMsg)).toEqual({
      state: "idle",
      needsYou: false,
      needsYouCertain: false,
    });
  });

  test("idle: live process but this session is not the newest in its project", () => {
    expect(classifySession("/p", NOW - 10_000, false, LIVE, NOW, userMsg).state).toBe("idle");
  });

  test("done: old write, no live process", () => {
    expect(classifySession("/p", NOW - 20 * 3_600_000, true, new Set(), NOW, userMsg).state).toBe("done");
  });

  test("null liveDirs (scan failed) never yields working", () => {
    expect(classifySession("/p", NOW - 1_000, true, null, NOW, userMsg).state).toBe("idle");
  });
});

describe("tools that ask for permission", () => {
  const call = (name: string): Array<{ message: { role: string; content: unknown } }> => [
    { message: { role: "user", content: "go" } },
    { message: { role: "assistant", content: [{ type: "tool_use", id: "t", name, input: {} }] } },
  ];
  test.each(["Bash", "Edit", "Write", "WebFetch", "AskUserQuestion"])("%s waits on the user for the wall and the pane alike", (name) => {
    expect(lastTurn(call(name))).toBe("permission");
    expect(lastTurn(call(name), "pane")).toBe("permission");
  });

  test.each(["NotebookEdit", "WebSearch", "ExitPlanMode", "mcp__github__create_issue"])("%s waits on the user in the pane's label only: the wall and the runner keep their set", (name) => {
    expect(lastTurn(call(name))).toBe("acting");
    expect(lastTurn(call(name), "pane")).toBe("permission");
  });

  test("does not count a read-only built-in", () => {
    expect(lastTurn(call("Read"), "pane")).toBe("acting");
  });

  test("a question to the user is waiting in every mode, auto-approve included, for the wall's classifier too", () => {
    expect(asksUser(call("AskUserQuestion"))).toBe(true);
    expect(asksUser(call("Bash"))).toBe(false);
    expect(asksUser([])).toBe(false);
    const live = new Set(["/p"]);
    const asked = classifySession("/p", NOW, true, live, NOW + 5_000, call("AskUserQuestion"), "auto");
    expect(asked).toEqual({ state: "idle", needsYou: true, needsYouCertain: true });
    const bash = classifySession("/p", NOW, true, live, NOW + 5_000, call("Bash"), "auto");
    expect(bash.state).toBe("working");
  });
});
