import { describe, expect, it } from "vitest";
import { assemblePrompt, composerState, fileMention, pathFromAgentRoot, sanitizeMessage, startsShellCommand, type ComposerInputs } from "./agent-pane-composer-model.js";

describe("sanitizeMessage", () => {
  it("is the shared paste sanitiser: line endings normalised, every control character dropped", () => {
    expect(sanitizeMessage("a\r\nb\rc\td")).toBe("a\nb\nc\td");
    expect(sanitizeMessage("hi\x1b[201~there")).toBe("hi[201~there");
    expect(sanitizeMessage("x\x1b[Zy")).toBe("x[Zy");
  });
});

describe("fileMention", () => {
  it("is @path, and quotes a path with spaces the way Claude Code reads it", () => {
    expect(fileMention("src/probe/resolve.ts")).toBe("@src/probe/resolve.ts");
    expect(fileMention("my dir/a b.ts")).toBe('@"my dir/a b.ts"');
    expect(fileMention("a\nb.ts")).toBe('@"a b.ts"');
    expect(fileMention('say "hi" now.ts')).toBe('@"say hi now.ts"');
  });
});

describe("assemblePrompt", () => {
  it("is the trimmed text", () => {
    expect(assemblePrompt("  Also fix the colour literal, then open a PR \n", undefined)).toBe("Also fix the colour literal, then open a PR");
  });

  it("is led by the pressed chip's path as @path", () => {
    expect(assemblePrompt("fix it", "src/probe/resolve.ts")).toBe("@src/probe/resolve.ts fix it");
  });

  it("is nothing for empty or blank text, with or without the chip", () => {
    expect(assemblePrompt("", "a.ts")).toBeUndefined();
    expect(assemblePrompt(" \n\t ", "a.ts")).toBeUndefined();
    expect(assemblePrompt("\x1b\x07", undefined)).toBeUndefined();
  });

  it("keeps the line breaks of a multi-line message, and quotes a path with spaces", () => {
    expect(assemblePrompt("one\ntwo", "my dir/a b.ts")).toBe('@"my dir/a b.ts" one\ntwo');
  });

  it("keeps a leading ! (the person's own text: nothing is submitted) when the chip is off", () => {
    expect(assemblePrompt("!git status", undefined)).toBe("!git status");
    expect(startsShellCommand("!git status")).toBe(true);
    expect(startsShellCommand("git status")).toBe(false);
    expect(startsShellCommand(undefined)).toBe(false);
  });
});

describe("pathFromAgentRoot", () => {
  it("is the file's path from the agent's own folder, which is not the workspace root the file lies in", () => {
    expect(pathFromAgentRoot("/w/mono/packages/app", "/w/mono/packages/app/src/a.ts")).toBe("src/a.ts");
    expect(pathFromAgentRoot("/w/mono/packages/app/", "/w/mono/packages/app/src/a.ts")).toBe("src/a.ts");
  });

  it("is undefined for a file outside the agent's folder, a sibling folder with the same prefix, or no folder", () => {
    expect(pathFromAgentRoot("/w/mono/packages/app", "/w/mono/packages/lib/a.ts")).toBeUndefined();
    expect(pathFromAgentRoot("/w/mono/packages/app", "/w/mono/packages/app2/a.ts")).toBeUndefined();
    expect(pathFromAgentRoot(undefined, "/w/a.ts")).toBeUndefined();
  });
});

describe("composerState", () => {
  const base: ComposerInputs = { draft: "go", running: true, trusted: true, ownSession: true, sending: false };

  it("lets a running agent be sent to and planned", () => {
    expect(composerState(base)).toEqual({ mode: "send", canSend: true, canPlan: true });
  });

  it("disables Send for an empty draft, silently", () => {
    expect(composerState({ ...base, draft: "  " })).toEqual({ mode: "send", canSend: false, canPlan: true });
  });

  it("does not look at what the agent is doing: a paste without Enter submits nothing, so it is never refused for that", () => {
    expect(Object.keys(base)).not.toContain("phase");
    expect(composerState(base).canSend).toBe(true);
  });

  it("disables everything in an untrusted workspace, and says so", () => {
    for (const running of [true, false]) {
      expect(composerState({ ...base, trusted: false, running })).toEqual({ mode: "send", canSend: false, canPlan: false, reason: "untrusted" });
    }
  });

  it("allows Send with no agent running (it starts one), but not Plan, which brings a running terminal forward", () => {
    expect(composerState({ ...base, running: false })).toEqual({ mode: "send", canSend: true, canPlan: false });
    expect(composerState({ ...base, running: false, draft: "" })).toEqual({ mode: "send", canSend: false, canPlan: false });
  });

  it("disables both while a send is in flight", () => {
    expect(composerState({ ...base, sending: true })).toEqual({ mode: "send", canSend: false, canPlan: false });
  });

  it("offers to open another session in a terminal instead of sending into the agent's own", () => {
    expect(composerState({ ...base, ownSession: false })).toEqual({ mode: "open", canSend: false, canPlan: false });
  });
});
