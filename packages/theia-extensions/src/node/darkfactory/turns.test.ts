import { describe, expect, it } from "vitest";
import { buildTurnsText } from "./turns.js";

describe("buildTurnsText", () => {
  it("keeps the last N user/assistant turns as role: text lines", () => {
    const entries = [
      { message: { role: "user", content: "first" } },
      { message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      { message: { role: "user", content: "second" } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit" }] } },
      { message: { role: "user", content: "third" } },
    ];
    const text = buildTurnsText(entries, 2);
    expect(text).toBe("assistant: [tool_use: Edit]\nuser: third");
  });

  it("returns an empty string for no entries", () => {
    expect(buildTurnsText([], 5)).toBe("");
  });

  it("keeps a legitimate turn whose content ends in a colon", () => {
    const entries = [{ message: { role: "user", content: "Steps:" } }];
    expect(buildTurnsText(entries, 1)).toBe("user: Steps:");
  });
});
