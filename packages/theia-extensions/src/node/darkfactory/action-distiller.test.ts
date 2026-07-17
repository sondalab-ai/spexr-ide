import { describe, expect, test } from "vitest";
import { distillAction, recentActions, lastActionFailed } from "./action-distiller.js";

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

  test("recentActions returns the last N tool calls as chips, chronological", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/a.ts" } }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/b.ts" } }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } },
    ];
    expect(recentActions(entries, 2)).toEqual(["Edit b.ts", "Bash pnpm test"]);
  });

  test("recentActions drops trivial shell commands and consecutive duplicates", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: `WT="x" cd /x` } }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/a.ts" } }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/a.ts" } }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm build --prod" } }] } },
    ];
    expect(recentActions(entries, 5)).toEqual(["Read a.ts", "Bash pnpm build"]);
  });

  test("lastActionFailed true when the latest tool_result is an error", () => {
    const ok = [{ message: { role: "user", content: [{ type: "tool_result", is_error: false }] } }];
    const bad = [{ message: { role: "user", content: [{ type: "tool_result", is_error: true }] } }];
    expect(lastActionFailed(ok)).toBe(false);
    expect(lastActionFailed(bad)).toBe(true);
    expect(lastActionFailed([])).toBe(false);
  });
});
