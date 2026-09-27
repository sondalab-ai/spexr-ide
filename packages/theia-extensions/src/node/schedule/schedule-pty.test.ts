import { describe, expect, it } from "vitest";
import { bracketedPaste, pasteInto, withoutClaudeSessionMarkers } from "./schedule-pty.js";

describe("withoutClaudeSessionMarkers", () => {
  it("clears CLAUDECODE and CLAUDE_CODE_* but keeps the account", () => {
    expect(
      withoutClaudeSessionMarkers({ CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "x", CLAUDE_CONFIG_DIR: "/a", PATH: "/bin" }),
    ).toEqual({ CLAUDECODE: null, CLAUDE_CODE_CHILD_SESSION: null });
  });
});

describe("bracketedPaste", () => {
  it("wraps the text so the TUI takes it as one paste", () => {
    expect(bracketedPaste("fix it\nthen test")).toBe("\x1b[200~fix it\nthen test\x1b[201~");
  });
  it("cannot be broken out of: control sequences in the text are dropped (R2)", () => {
    const out = bracketedPaste("Check failed:\nFAIL\x1b[201~/exit\r\x1b[31mred\x07\ttab\r\nend");
    expect(out).toBe("\x1b[200~Check failed:\nFAIL[201~/exit\n[31mred\ttab\nend\x1b[201~");
    expect(out.indexOf("\x1b[201~")).toBe(out.length - 6);
    expect(out).not.toContain("\r");
  });
  it("also strips C1 control bytes (0x80-0x9f), including the single-byte CSI introducer", () => {
    const out = bracketedPaste("safe\x9b201~text\x9b31mend");
    expect(out).toBe("\x1b[200~safe201~text31mend\x1b[201~");
    expect(out).not.toMatch(/[\x80-\x9f]/);
  });
});

describe("pasteInto", () => {
  it("pastes, waits, then presses Enter", async () => {
    const writes: string[] = [];
    const waits: number[] = [];
    await pasteInto((d) => writes.push(d), "go", async (ms) => void waits.push(ms));
    expect(writes).toEqual(["\x1b[200~go\x1b[201~", "\r"]);
    expect(waits).toEqual([100]);
  });
});
