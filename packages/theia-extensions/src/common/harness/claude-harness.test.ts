import { describe, expect, test } from "vitest";
import { claudeHarness } from "./claude-harness.js";

const UUID = "edd149a5-2e9b-4db6-9380-66e962be6802";

describe("claudeHarness", () => {
  test("id and process names", () => {
    expect(claudeHarness.id).toBe("claude");
    expect(claudeHarness.processNames()).toEqual(["claude"]);
  });

  test("resumable id is a UUID", () => {
    expect(claudeHarness.isResumableId(UUID)).toBe(true);
    expect(claudeHarness.isResumableId("not-a-uuid")).toBe(false);
  });

  test("resume args match legacy behavior", () => {
    expect(claudeHarness.buildResumeArgs(UUID, false)).toEqual(["--resume", UUID]);
    expect(claudeHarness.buildResumeArgs(UUID, true)).toEqual(["--resume", UUID, "--fork-session"]);
  });
});
