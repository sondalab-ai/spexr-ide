import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "./schedule-types.js";
import {
  CONVERGED_MARKER,
  MAX_REPLY_CHARS,
  fillPlaceholders,
  firstPrompt,
  followUpPrompt,
  hasConverged,
  placeholdersIn,
  stripMarker,
} from "./schedule-prompt.js";

const base: ScheduleTask = {
  id: "t",
  name: "T",
  needs: [],
  project: "/repo",
  workspace: { kind: "folder" },
  harness: "claude",
  prompt: "Fix the build.",
};

describe("placeholdersIn", () => {
  it("finds reply and workspace references, tolerating inner spaces", () => {
    expect(placeholdersIn("see {{ api.reply }} in {{api.workspace}}")).toEqual([
      { task: "api", field: "reply" },
      { task: "api", field: "workspace" },
    ]);
  });
  it("ignores unknown fields", () => {
    expect(placeholdersIn("{{api.secret}}")).toEqual([]);
  });
});

describe("fillPlaceholders", () => {
  it("replaces each reference, and an unknown one with nothing", () => {
    const out = fillPlaceholders("A={{a.reply}} B={{b.workspace}}", (task, field) =>
      task === "a" && field === "reply" ? "done" : undefined,
    );
    expect(out).toBe("A=done B=");
  });
  it("cuts a long reply to MAX_REPLY_CHARS and says so", () => {
    const out = fillPlaceholders("{{a.reply}}", () => "x".repeat(MAX_REPLY_CHARS + 10));
    expect(out.startsWith("x".repeat(MAX_REPLY_CHARS))).toBe(true);
    expect(out).toMatch(/cut to \d+ characters/);
  });
});

describe("firstPrompt", () => {
  it("is the filled prompt alone for a task without a loop", () => {
    expect(firstPrompt(base, "Fix the build.")).toBe("Fix the build.");
  });
  it("appends the stop criteria and the marker instruction for a looping task", () => {
    const looped = { ...base, loop: { stopCriteria: "All tests pass.", followUp: "Go on.", maxIterations: 3 } };
    const p = firstPrompt(looped, "Fix the build.");
    expect(p.startsWith("Fix the build.")).toBe(true);
    expect(p).toContain("All tests pass.");
    expect(p).toContain(CONVERGED_MARKER);
  });
});

describe("followUpPrompt", () => {
  const looped = { ...base, loop: { stopCriteria: "S", followUp: "Keep going.", maxIterations: 3, check: "pnpm test" } };
  it("repeats the marker reminder", () => {
    const p = followUpPrompt(looped);
    expect(p.startsWith("Keep going.")).toBe(true);
    expect(p).toContain(CONVERGED_MARKER);
  });
  it("carries a failed check's command and output", () => {
    const p = followUpPrompt(looped, { command: "pnpm test", tail: "1 failed" });
    expect(p).toContain("pnpm test");
    expect(p).toContain("1 failed");
  });
});

describe("hasConverged", () => {
  it("accepts the marker as the last non-empty line, with light markdown", () => {
    expect(hasConverged("All done.\n\nCONVERGED\n\n")).toBe(true);
    expect(hasConverged("All done.\n**CONVERGED**")).toBe(true);
    expect(hasConverged("All done.\n`CONVERGED`")).toBe(true);
  });
  it("rejects the marker anywhere else", () => {
    expect(hasConverged("I will write CONVERGED when done.\nNot yet.")).toBe(false);
    expect(hasConverged("CONVERGED\nmore work")).toBe(false);
    expect(hasConverged("NOT CONVERGED")).toBe(false);
    expect(hasConverged("")).toBe(false);
  });
});

describe("stripMarker", () => {
  it("drops a closing marker line and keeps everything else", () => {
    expect(stripMarker("Done.\nCONVERGED\n")).toBe("Done.");
    expect(stripMarker("Done.")).toBe("Done.");
  });
});
