import { describe, expect, it } from "vitest";
import { TOOL_ROWS_SHOWN, formatDuration, inlineCode, modelFamily, plainTarget, shortId, toolIcon, visibleTools } from "./agent-pane-format.js";
import type { PaneTool } from "../../common/agent-pane-protocol.js";

describe("modelFamily", () => {
  it.each([
    ["claude-opus-5-5", "Opus"],
    ["claude-sonnet-4-20250514", "Sonnet"],
    ["claude-haiku-5-5", "Haiku"],
    ["Claude-FABLE-1", "Fable"],
    ["some-other-model", "some-other-model"],
  ])("%s is %s", (model, family) => expect(modelFamily(model)).toBe(family));

  it("has none for no model", () => {
    expect(modelFamily(undefined)).toBeUndefined();
    expect(modelFamily("")).toBeUndefined();
  });
});

describe("shortId", () => {
  it("is the first six characters, dashes not counted", () => {
    expect(shortId("8f2a4c1e-3b7d-4e52-9a61-0c5d2e8b7f13")).toBe("8f2a4c");
    expect(shortId("ab")).toBe("ab");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0.0 s"],
    [200, "0.2 s"],
    [1100, "1.1 s"],
    [2400, "2.4 s"],
    [9949, "9.9 s"],
    [10_400, "10 s"],
    [59_400, "59 s"],
    [65_000, "1 m 05 s"],
    [3_725_000, "62 m 05 s"],
  ])("%d ms is %s", (ms, text) => expect(formatDuration(ms)).toBe(text));
});

describe("toolIcon", () => {
  it("is by what the tool does, with a fallback", () => {
    const icon = (verb?: string): string => toolIcon({ id: "x", state: "done", ...(verb ? { verb } : {}) });
    expect(icon("Read")).toBe("codicon-file");
    expect(icon("Edit")).toBe("codicon-edit");
    expect(icon("Write")).toBe("codicon-edit");
    expect(icon("Run")).toBe("codicon-terminal");
    expect(icon("Find")).toBe("codicon-search");
    expect(icon("mcp__thing")).toBe("codicon-tools");
    expect(icon()).toBe("codicon-tools");
  });
});

describe("visibleTools", () => {
  const tools = (n: number): PaneTool[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, state: "done" as const }));

  it("shows every row up to the fold, the last few beyond it, all when expanded", () => {
    expect(visibleTools(tools(TOOL_ROWS_SHOWN), false)).toEqual({ shown: tools(TOOL_ROWS_SHOWN), hidden: 0 });
    const folded = visibleTools(tools(11), false);
    expect(folded.shown.map((t) => t.id)).toEqual(["t7", "t8", "t9", "t10"]);
    expect(folded.hidden).toBe(7);
    expect(visibleTools(tools(11), true)).toEqual({ shown: tools(11), hidden: 0 });
  });
});

describe("plainTarget", () => {
  it("takes a search pattern's regex escapes out, and leaves a file or a command alone", () => {
    expect(plainTarget({ id: "a", state: "done", verb: "Search", target: "cache\\.write" })).toBe("cache.write");
    expect(plainTarget({ id: "a", state: "done", verb: "Find", target: "src/**/*.ts" })).toBe("src/**/*.ts");
    expect(plainTarget({ id: "a", state: "done", verb: "Run", target: "echo a\\.b" })).toBe("echo a\\.b");
    expect(plainTarget({ id: "a", state: "done", verb: "Read", target: "a\\b.ts" })).toBe("a\\b.ts");
    expect(plainTarget({ id: "a", state: "done" })).toBeUndefined();
  });
});

describe("inlineCode", () => {
  it("splits text at backtick spans", () => {
    expect(inlineCode("Make `cache.write` awaited and `x` too")).toEqual([
      { code: false, text: "Make " },
      { code: true, text: "cache.write" },
      { code: false, text: " awaited and " },
      { code: true, text: "x" },
      { code: false, text: " too" },
    ]);
  });

  it("keeps an unmatched backtick, an empty span and plain text as text", () => {
    expect(inlineCode("a ` b")).toEqual([{ code: false, text: "a ` b" }]);
    expect(inlineCode("a `` b")).toEqual([{ code: false, text: "a `` b" }]);
    expect(inlineCode("plain")).toEqual([{ code: false, text: "plain" }]);
    expect(inlineCode("")).toEqual([]);
  });

  it("does not span lines", () => {
    expect(inlineCode("`a\nb`")).toEqual([{ code: false, text: "`a\nb`" }]);
  });
});
