import { describe, expect, it } from "vitest";
import { classifyState } from "./liveness.js";

const HOUR = 3_600_000;

describe("classifyState", () => {
  it("open transcript is live regardless of mtime", () => {
    const open = new Set(["/p/a.jsonl"]);
    expect(classifyState("/p/a.jsonl", 0, open, 100 * HOUR, 12 * HOUR)).toBe("live");
  });

  it("recently modified but not open is idle", () => {
    expect(classifyState("/p/a.jsonl", 95 * HOUR, new Set(), 100 * HOUR, 12 * HOUR)).toBe("idle");
  });

  it("old and not open is archived", () => {
    expect(classifyState("/p/a.jsonl", 10 * HOUR, new Set(), 100 * HOUR, 12 * HOUR)).toBe("archived");
  });

  it("null openPaths (lsof unavailable) never yields live", () => {
    expect(classifyState("/p/a.jsonl", 95 * HOUR, null, 100 * HOUR, 12 * HOUR)).toBe("idle");
  });
});
