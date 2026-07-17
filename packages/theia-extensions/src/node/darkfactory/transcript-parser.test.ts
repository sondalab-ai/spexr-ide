import { describe, expect, it } from "vitest";
import { parseTranscript } from "./transcript-parser.js";

describe("parseTranscript", () => {
  it("extracts cwd, branch, modes, turn count, last prompt, last tool", () => {
    const lines = [
      `{"type":"mode","mode":"normal"}`,
      `{"type":"permission-mode","permissionMode":"auto"}`,
      `{"cwd":"/Users/x/src/proj","gitBranch":"main","type":"user","message":{"role":"user","content":"refactor auth"}}`,
      `not json — must be skipped`,
      `{"cwd":"/Users/x/src/proj","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit"}]}}`,
      `{"cwd":"/Users/x/src/proj","type":"user","message":{"role":"user","content":"now run tests"}}`,
    ];

    const p = parseTranscript(lines);
    expect(p.cwd).toBe("/Users/x/src/proj");
    expect(p.gitBranch).toBe("main");
    expect(p.mode).toBe("normal");
    expect(p.permissionMode).toBe("auto");
    expect(p.userTurns).toBe(2);
    expect(p.lastPrompt).toBe("now run tests");
    expect(p.lastTool).toBe("Edit");
    expect(p.interactive).toBe(true);
    expect(p.goal).toBe("refactor auth"); // first genuine prompt
  });

  it("goal skips injected/meta prompts and takes the first genuine one", () => {
    const p = parseTranscript([
      `{"type":"mode","mode":"normal"}`,
      `{"isMeta":true,"message":{"role":"user","content":"<local-command-caveat>hooks</local-command-caveat>"}}`,
      `{"message":{"role":"user","content":"<command-name>/clear</command-name>"}}`,
      `{"message":{"role":"user","content":"Base directory for this skill: /x/SKILL.md"}}`,
      `{"message":{"role":"user","content":"build the darkfactory view"}}`,
      `{"message":{"role":"user","content":"[Request interrupted by user for tool use]"}}`,
    ]);
    expect(p.goal).toBe("build the darkfactory view");
  });

  it("empty transcript yields safe defaults", () => {
    const p = parseTranscript([]);
    expect(p.cwd).toBeUndefined();
    expect(p.userTurns).toBe(0);
    expect(p.lastPrompt).toBe("");
    expect(p.interactive).toBe(false);
  });

  it("SDK/one-shot session without a mode entry is not interactive", () => {
    const p = parseTranscript([
      `{"type":"queue-operation","operation":"enqueue"}`,
      `{"cwd":"/x","type":"user","message":{"role":"user","content":"review this"}}`,
    ]);
    expect(p.interactive).toBe(false);
    expect(p.cwd).toBe("/x");
  });
});
