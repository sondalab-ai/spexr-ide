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

  it("takes prompt-cache facts from the last usage-bearing assistant entry", () => {
    const p = parseTranscript([
      `{"type":"assistant","timestamp":"2026-09-10T08:00:00.000Z","message":{"role":"assistant","usage":{"input_tokens":4,"cache_creation_input_tokens":1000,"cache_read_input_tokens":9000}}}`,
      `{"type":"assistant","timestamp":"not a date","message":{"role":"assistant","usage":{"input_tokens":1,"cache_read_input_tokens":50}}}`,
      `{"type":"assistant","timestamp":"2026-09-10T08:10:00.000Z","message":{"role":"assistant","usage":{"input_tokens":2,"cache_creation_input_tokens":500,"cache_read_input_tokens":20000}}}`,
      `{"type":"assistant","timestamp":"2026-09-10T08:11:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}`,
    ]);
    // Last one wins, and the unparseable timestamp in between is skipped whole.
    expect(p.cache).toEqual({
      contextTokens: 20_502,
      lastRequestMs: Date.parse("2026-09-10T08:10:00.000Z"),
    });
  });

  it("ignores a subagent's usage — it runs against its own prompt cache", () => {
    const p = parseTranscript([
      `{"type":"assistant","timestamp":"2026-09-10T08:00:00.000Z","message":{"role":"assistant","usage":{"input_tokens":2,"cache_read_input_tokens":180000}}}`,
      `{"type":"assistant","isSidechain":true,"timestamp":"2026-09-10T08:05:00.000Z","message":{"role":"assistant","usage":{"input_tokens":1,"cache_read_input_tokens":4000}}}`,
    ]);
    expect(p.cache?.contextTokens).toBe(180_002);
  });

  it("leaves the cache facts absent when no entry reports usage", () => {
    const p = parseTranscript([
      `{"cwd":"/x","type":"user","message":{"role":"user","content":"go"}}`,
      `{"type":"assistant","timestamp":"2026-09-10T08:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit"}]}}`,
      `{"type":"assistant","timestamp":"2026-09-10T08:01:00.000Z","message":{"role":"assistant","usage":{"input_tokens":0}}}`,
    ]);
    expect(p.cache).toBeUndefined();
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
