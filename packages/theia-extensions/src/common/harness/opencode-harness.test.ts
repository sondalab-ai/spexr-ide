import { describe, expect, it } from "vitest";
import { opencodeHarness, opencodeMessageToEntry, opencodeExportToEntries } from "./opencode-harness.js";

describe("opencodeHarness.isResumableId", () => {
  it("accepts opaque ses_ ids", () => {
    expect(opencodeHarness.isResumableId("ses_fefddda33fferVOQBC6QZrlycV")).toBe(true);
    expect(opencodeHarness.isResumableId("ses_abc123")).toBe(true);
  });

  it("rejects non-ses ids and shell metacharacters", () => {
    expect(opencodeHarness.isResumableId("")).toBe(false);
    expect(opencodeHarness.isResumableId("0f8f…cdef")).toBe(false);
    expect(opencodeHarness.isResumableId("ses_abc;rm -rf /")).toBe(false);
    expect(opencodeHarness.isResumableId("ses_abc$(x)")).toBe(false);
    expect(opencodeHarness.isResumableId("ses_abc def")).toBe(false);
  });
});

describe("opencodeHarness.buildResumeArgs", () => {
  it("resumes with --session <id>", () => {
    expect(opencodeHarness.buildResumeArgs("ses_abc", false)).toEqual(["--session", "ses_abc"]);
  });

  it("adds --fork (not Claude's --fork-session) when forking", () => {
    expect(opencodeHarness.buildResumeArgs("ses_abc", true)).toEqual(["--session", "ses_abc", "--fork"]);
  });
});

describe("opencodeMessageToEntry", () => {
  it("maps text parts to text blocks and tool parts to tool_use blocks", () => {
    const entry = opencodeMessageToEntry({
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "On it." },
        { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
      ],
    });
    expect(entry).toEqual({
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
        ],
      },
    });
  });

  it("maps opencode tool names/inputs to Claude shape (bash→Bash, filePath→file_path)", () => {
    const entry = opencodeMessageToEntry({
      info: { role: "assistant" },
      parts: [
        { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
        { type: "tool", tool: "read", state: { input: { filePath: "/x/auth.ts" } } },
      ],
    });
    expect(entry?.message.content).toEqual([
      { type: "tool_use", name: "Bash", input: { command: "pnpm test" } },
      { type: "tool_use", name: "Read", input: { file_path: "/x/auth.ts" } },
    ]);
  });

  it("drops messages with no usable parts and unknown roles", () => {
    expect(opencodeMessageToEntry({ info: { role: "assistant" }, parts: [{ type: "step-start" }] })).toBeUndefined();
    expect(opencodeMessageToEntry({ info: {}, parts: [{ type: "text", text: "x" }] })).toBeUndefined();
  });
});

describe("opencode entry normalization feeds the shared consumers", () => {
  const entries = opencodeExportToEntries([
    { info: { role: "user" }, parts: [{ type: "text", text: "fix the auth bug" }] },
    {
      info: { role: "assistant" },
      parts: [
        { type: "text", text: "On it." },
        { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
      ],
    },
  ]);

  it("distillAction / recentActions recognize the normalized tool_use blocks", async () => {
    const { distillAction, recentActions } = await import("../../node/darkfactory/action-distiller.js");
    expect(distillAction(entries as never)).toEqual({ line: "Running: pnpm test", tool: "Bash", target: "pnpm test" });
    expect(recentActions(entries as never, 4)).toEqual(["Bash pnpm test"]);
  });

  it("buildFollowEvents splits prompt, reply, and tool call into typed events", async () => {
    const { buildFollowEvents } = await import("../../node/darkfactory/turns.js");
    expect(buildFollowEvents(entries as never, 10)).toEqual([
      { kind: "prompt", text: "fix the auth bug" },
      { kind: "assistant", text: "On it." },
      { kind: "tool", text: "pnpm test" },
    ]);
  });
});

describe("opencodeHarness.parseTranscript (via export fixture)", () => {
  const ref = {
    sessionId: "ses_fixture",
    projectPath: "/tmp/proj",
    mtimeMs: 1786987872778,
    loadEntries: async () =>
      opencodeExportToEntries([
        { info: { role: "user" }, parts: [{ type: "text", text: "fix the auth bug" }] },
        {
          info: { role: "assistant" },
          parts: [
            { type: "tool", tool: "bash", state: { input: { command: "pnpm test" } } },
            { type: "text", text: "done" },
          ],
        },
      ]),
  };

  it("extracts goal, turns, lastTool, cwd, interactive", async () => {
    const p = await opencodeHarness.parseTranscript(ref);
    expect(p).toEqual({
      cwd: "/tmp/proj",
      userTurns: 1,
      goal: "fix the auth bug",
      lastPrompt: "fix the auth bug",
      lastTool: "Bash",
      interactive: true,
    });
  });

  it("returns empty fields for an export with no messages", async () => {
    const empty = { ...ref, loadEntries: async () => [] };
    const p = await opencodeHarness.parseTranscript(empty);
    expect(p).toEqual({ cwd: "/tmp/proj", userTurns: 0, goal: "", lastPrompt: "", interactive: true });
  });
});
