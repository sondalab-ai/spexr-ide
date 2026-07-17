import { describe, expect, test } from "vitest";
import { distillAction } from "./action-distiller.js";

describe("action-distiller", () => {
  test("last tool_use → verb + target", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/src/auth.ts" } }] } },
    ];
    expect(distillAction(entries)).toEqual({ line: "Editing auth.ts", tool: "Edit", target: "auth.ts" });
  });

  test("Bash tool → running command", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } },
    ];
    expect(distillAction(entries)).toEqual({ line: "Running: pnpm test", tool: "Bash", target: "pnpm test" });
  });

  test("trailing assistant text → thinking/replying", () => {
    const entries = [{ message: { role: "assistant", content: [{ type: "text", text: "Here is the plan for the refactor" }] } }];
    expect(distillAction(entries).line).toMatch(/^Here is the plan/);
  });

  test("empty transcript → neutral line", () => {
    expect(distillAction([]).line).toBe("No activity yet");
  });
});
