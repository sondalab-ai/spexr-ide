import { describe, expect, test } from "vitest";
import { classifySession } from "./session-state.js";

const WORKING_WINDOW = 45_000;
const NOW = 1_000_000_000_000;

describe("session-state", () => {
  test("working: live process in project AND newest transcript AND recent write", () => {
    expect(classifySession("/p", NOW - 10_000, true, new Set(["/p"]), NOW, WORKING_WINDOW)).toBe("working");
  });

  test("idle: recent write but no live process in project", () => {
    expect(classifySession("/p", NOW - 10_000, true, new Set(), NOW, WORKING_WINDOW)).toBe("idle");
  });

  test("idle: live process but this session is not the newest in its project", () => {
    expect(classifySession("/p", NOW - 10_000, false, new Set(["/p"]), NOW, WORKING_WINDOW)).toBe("idle");
  });

  test("done: old write, no live process", () => {
    expect(classifySession("/p", NOW - 20 * 3_600_000, true, new Set(), NOW, WORKING_WINDOW)).toBe("done");
  });

  test("null liveDirs (scan failed) never yields working", () => {
    expect(classifySession("/p", NOW - 1_000, true, null, NOW, WORKING_WINDOW)).toBe("idle");
  });
});
