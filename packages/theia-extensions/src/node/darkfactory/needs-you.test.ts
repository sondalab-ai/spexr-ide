import { describe, expect, test } from "vitest";
import { guessNeedsYou } from "./needs-you.js";

const NOW = 1_000_000;
const permTurn = [{ message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "rm x" } }] } }];

describe("needs-you", () => {
  test("live + trailing permission tool-use + settled → maybe waiting", () => {
    expect(guessNeedsYou(permTurn, true, NOW - 4_000, NOW)).toBe(true);
  });

  test("not live → false", () => {
    expect(guessNeedsYou(permTurn, false, NOW - 4_000, NOW)).toBe(false);
  });

  test("recent write (still streaming) → false", () => {
    expect(guessNeedsYou(permTurn, true, NOW - 200, NOW)).toBe(false);
  });

  test("trailing plain text (not a tool) → false", () => {
    expect(
      guessNeedsYou([{ message: { role: "assistant", content: [{ type: "text", text: "done" }] } }], true, NOW - 4_000, NOW),
    ).toBe(false);
  });
});
