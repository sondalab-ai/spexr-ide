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
  });

  it("empty transcript yields safe defaults", () => {
    const p = parseTranscript([]);
    expect(p.cwd).toBeUndefined();
    expect(p.userTurns).toBe(0);
    expect(p.lastPrompt).toBe("");
  });
});
