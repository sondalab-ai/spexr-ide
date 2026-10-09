import { describe, expect, it } from "vitest";
import { SHIFT_TAB, assemblePrompt, composerState, sanitizeMessage, type ComposerInputs } from "./agent-pane-composer-model.js";

describe("sanitizeMessage", () => {
  it("normalises line endings and keeps newlines and tabs", () => {
    expect(sanitizeMessage("a\r\nb\rc\td")).toBe("a\nb\nc\td");
  });

  it("drops escapes and other control characters, so text can never be taken for a key or end a paste", () => {
    expect(sanitizeMessage("hi\x1b[201~there")).toBe("hi[201~there");
    expect(sanitizeMessage("a\x00b\x07c\x7fd\x9be")).toBe("abcde");
    expect(sanitizeMessage(`x${SHIFT_TAB}y`)).toBe("x[Zy");
  });

  it("leaves ordinary and non-latin text alone", () => {
    expect(sanitizeMessage("Also fix the colour literal, è 日本 \u{1f600}")).toBe("Also fix the colour literal, è 日本 \u{1f600}");
  });
});

describe("assemblePrompt", () => {
  it("is the trimmed text", () => {
    expect(assemblePrompt("  Also fix the colour literal, then open a PR \n", undefined)).toBe("Also fix the colour literal, then open a PR");
  });

  it("is led by the pressed chip's workspace-relative path as @path", () => {
    expect(assemblePrompt("fix it", "src/probe/resolve.ts")).toBe("@src/probe/resolve.ts fix it");
  });

  it("is nothing for empty or blank text, with or without the chip", () => {
    expect(assemblePrompt("", "a.ts")).toBeUndefined();
    expect(assemblePrompt(" \n\t ", "a.ts")).toBeUndefined();
    expect(assemblePrompt("\x1b\x07", undefined)).toBeUndefined();
  });

  it("keeps the line breaks of a multi-line message, and a path with spaces on one line", () => {
    expect(assemblePrompt("one\ntwo", "my dir/a b.ts")).toBe("@my dir/a b.ts one\ntwo");
    expect(assemblePrompt("x", "a\nb.ts")).toBe("@a b.ts x");
  });
});

describe("SHIFT_TAB", () => {
  it("is the escape sequence a Shift+Tab key sends", () => {
    expect(SHIFT_TAB).toBe("\u001b[Z");
  });
});

describe("composerState", () => {
  const base: ComposerInputs = { draft: "go", running: true, phase: "ready", trusted: true, ownSession: true, sending: false };

  it("lets a running agent at its prompt be sent to and planned", () => {
    expect(composerState(base)).toEqual({ mode: "send", canSend: true, canPlan: true });
  });

  it("disables Send for an empty draft, silently", () => {
    expect(composerState({ ...base, draft: "  " })).toEqual({ mode: "send", canSend: false, canPlan: true });
  });

  it("disables both while the agent is working, and says so", () => {
    expect(composerState({ ...base, phase: "working" })).toEqual({ mode: "send", canSend: false, canPlan: false, reason: "working" });
  });

  it("disables both while the phase is not known yet: never ready by default", () => {
    expect(composerState({ ...base, phase: undefined })).toEqual({ mode: "send", canSend: false, canPlan: false, reason: "working" });
  });

  it("disables both while a permission may be pending, and says why", () => {
    expect(composerState({ ...base, phase: "permission" })).toEqual({ mode: "send", canSend: false, canPlan: false, reason: "needs-you" });
  });

  it("disables everything in an untrusted workspace, whatever the phase", () => {
    for (const running of [true, false]) {
      expect(composerState({ ...base, trusted: false, running })).toEqual({ mode: "send", canSend: false, canPlan: false, reason: "untrusted" });
    }
  });

  it("allows Send with no agent running (it only starts one), but not Plan, which is a key into a running TUI", () => {
    expect(composerState({ ...base, running: false, phase: undefined })).toEqual({ mode: "send", canSend: true, canPlan: false });
    expect(composerState({ ...base, running: false, phase: undefined, draft: "" })).toEqual({ mode: "send", canSend: false, canPlan: false });
  });

  it("disables both while a send is in flight", () => {
    expect(composerState({ ...base, sending: true })).toEqual({ mode: "send", canSend: false, canPlan: false });
  });

  it("offers to open another session in a terminal instead of sending into the agent's own", () => {
    expect(composerState({ ...base, ownSession: false })).toEqual({ mode: "open", canSend: false, canPlan: false });
  });
});
