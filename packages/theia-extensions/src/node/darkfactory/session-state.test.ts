import { describe, expect, test } from "vitest";
import { classifySession, isTurnOpen } from "./session-state.js";

const NOW = 1_000_000_000_000;
const OPEN = true;
const CLOSED = false;

describe("isTurnOpen", () => {
  test("true: last entry is a user message (prompt or tool_result to act on)", () => {
    expect(isTurnOpen([{ message: { role: "user", content: "hi" } }])).toBe(true);
  });

  test("true: last assistant entry ends in a tool_use (tool running / permission pending)", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "text", text: "let me" }, { type: "tool_use", name: "Bash" }] } },
    ];
    expect(isTurnOpen(entries)).toBe(true);
  });

  test("false: assistant ended its turn with a text reply (waiting on the human)", () => {
    const entries = [{ message: { role: "assistant", content: [{ type: "text", text: "done" }] } }];
    expect(isTurnOpen(entries)).toBe(false);
  });

  test("false: no entries", () => {
    expect(isTurnOpen([])).toBe(false);
  });
});

describe("classifySession", () => {
  const openTurn = () => new Set(["/p"]);

  test("working: live process, newest transcript, turn open", () => {
    expect(classifySession("/p", NOW - 10_000, true, openTurn(), NOW, OPEN)).toBe("working");
  });

  test("working stays even when the last write is old, as long as the turn is open", () => {
    expect(classifySession("/p", NOW - 5 * 60_000, true, openTurn(), NOW, OPEN)).toBe("working");
  });

  test("idle: live and newest but the assistant ended its turn (not working)", () => {
    expect(classifySession("/p", NOW - 10_000, true, openTurn(), NOW, CLOSED)).toBe("idle");
  });

  test("idle: recent write but no live process in project", () => {
    expect(classifySession("/p", NOW - 10_000, true, new Set(), NOW, OPEN)).toBe("idle");
  });

  test("idle: live process but this session is not the newest in its project", () => {
    expect(classifySession("/p", NOW - 10_000, false, openTurn(), NOW, OPEN)).toBe("idle");
  });

  test("done: old write, no live process", () => {
    expect(classifySession("/p", NOW - 20 * 3_600_000, true, new Set(), NOW, OPEN)).toBe("done");
  });

  test("null liveDirs (scan failed) never yields working", () => {
    expect(classifySession("/p", NOW - 1_000, true, null, NOW, OPEN)).toBe("idle");
  });
});
