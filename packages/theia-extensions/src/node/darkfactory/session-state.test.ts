import { describe, expect, test } from "vitest";
import { classifySession } from "./session-state.js";

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

  test("needs-you (certain): a permission tool has stalled", () => {
    expect(classifySession("/p", NOW - 4_000, true, LIVE, NOW, toolUse("Bash"))).toEqual({
      state: "idle",
      needsYou: true,
      needsYouCertain: true,
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
