import { describe, expect, test } from "vitest";
import { buildResumeArgs, isSessionId } from "./resume-args.js";

const ID = "edd149a5-2e9b-4db6-9380-66e962be6802";

describe("resume-args", () => {
  test("valid uuid → --resume <id>", () => {
    expect(buildResumeArgs(ID, false)).toEqual(["--resume", ID]);
  });

  test("fork adds --fork-session", () => {
    expect(buildResumeArgs(ID, true)).toEqual(["--resume", ID, "--fork-session"]);
  });

  test("non-uuid sessionId is rejected", () => {
    expect(() => buildResumeArgs("; rm -rf /", false)).toThrow();
    expect(isSessionId("; rm -rf /")).toBe(false);
    expect(isSessionId(ID)).toBe(true);
  });
});
