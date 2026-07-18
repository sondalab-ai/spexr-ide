import { describe, expect, it } from "vitest";
import { buildTurnsText, buildFollowEvents } from "./turns.js";

describe("buildFollowEvents", () => {
  it("splits each prompt, reply, tool call, and result into its own typed event", () => {
    const entries = [
      { message: { role: "user", content: "fix the auth bug" } },
      { message: { role: "assistant", content: [{ type: "text", text: "On it." }, { type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } },
      { message: { role: "user", content: [{ type: "tool_result", content: "2 passing" }] } },
      { message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "boom" }] } },
    ];
    expect(buildFollowEvents(entries, 10)).toEqual([
      { kind: "prompt", text: "fix the auth bug" },
      { kind: "assistant", text: "On it." },
      { kind: "tool", text: "pnpm test" },
      { kind: "result", text: "2 passing" },
      { kind: "error", text: "boom" },
    ]);
  });

  it("keeps the raw shell command for Bash (not the shortened digest form)", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "git commit -m 'x' && git push" } }] } },
    ];
    expect(buildFollowEvents(entries, 10)[0]).toEqual({ kind: "tool", text: "git commit -m 'x' && git push" });
  });

  it("drops injected/meta prompts and caps to the last N events", () => {
    const entries = [
      { isMeta: true, message: { role: "user", content: "<reminder>" } },
      { message: { role: "assistant", content: [{ type: "text", text: "a" }] } },
      { message: { role: "assistant", content: [{ type: "text", text: "b" }] } },
    ];
    expect(buildFollowEvents(entries, 1)).toEqual([{ kind: "assistant", text: "b" }]);
  });
});

describe("buildTurnsText", () => {
  it("renders tool_use with its target and keeps the last N events plus the goal", () => {
    const entries = [
      { message: { role: "user", content: "first" } },
      { message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      { message: { role: "user", content: "second" } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/auth.ts" } }] } },
      { message: { role: "user", content: "third" } },
    ];
    // last 2 events → [assistant: [Edit auth.ts], user: third]; goal "user: first" prepended.
    expect(buildTurnsText(entries, 2)).toBe("user: first\nassistant: [Edit auth.ts]\nuser: third");
  });

  it("returns an empty string for no entries", () => {
    expect(buildTurnsText([], 5)).toBe("");
  });

  it("keeps a legitimate prompt whose content ends in a colon", () => {
    const entries = [{ message: { role: "user", content: "Steps:" } }];
    expect(buildTurnsText(entries, 1)).toBe("user: Steps:");
  });

  it("renders the bash command as the tool target", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: `NODE_ENV=test pnpm --filter x test` } }] } },
    ];
    expect(buildTurnsText(entries, 5)).toBe("assistant: [Bash: pnpm --filter x test]");
  });

  it("surfaces failed tool results and drops successful ones", () => {
    const entries = [
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm build" } }] } },
      { message: { role: "user", content: [{ type: "tool_result", is_error: true, content: "TS2345: type mismatch" }] } },
      { message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/a.ts" } }] } },
      { message: { role: "user", content: [{ type: "tool_result", is_error: false, content: "file body here" }] } },
    ];
    expect(buildTurnsText(entries, 10)).toBe(
      "assistant: [Bash: pnpm build]\ntool error: TS2345: type mismatch\nassistant: [Read a.ts]",
    );
  });

  it("drops injected and meta user prompts", () => {
    const entries = [
      { isMeta: true, message: { role: "user", content: "<command-name>compact</command-name>" } },
      { message: { role: "user", content: "## Context\nsome injected block" } },
      { message: { role: "user", content: "real instruction" } },
    ];
    expect(buildTurnsText(entries, 10)).toBe("user: real instruction");
  });
});

describe("describeToolUse", () => {
  it("keeps a stripped bash command, a basename for file tools, and a raw pattern for search", async () => {
    const { describeToolUse } = await import("./action-distiller.js");
    expect(describeToolUse("Bash", { command: `FOO=1 git push origin main` })).toBe("Bash: git push origin main");
    expect(describeToolUse("Edit", { file_path: "/a/b/auth.ts" })).toBe("Edit auth.ts");
    expect(describeToolUse("Grep", { pattern: "authToken" })).toBe("Grep authToken");
    expect(describeToolUse("Bash", undefined)).toBe("Bash");
  });
});
