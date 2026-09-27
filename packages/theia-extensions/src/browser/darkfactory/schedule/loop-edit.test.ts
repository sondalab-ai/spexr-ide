import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "../../../common/schedule/schedule-types.js";
import { DEFAULT_LOOP, patchLoop, withCheck, withCheckTimeout, withLoop, withMaxIterations } from "./loop-edit.js";

const t: ScheduleTask = { id: "a", name: "A", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p" };

describe("loop editing", () => {
  it("switches the loop on with defaults, keeps it when already on, and drops every loop setting when off", () => {
    const on = withLoop(t, true);
    expect(on.loop).toEqual(DEFAULT_LOOP);
    expect(withLoop(on, true)).toBe(on);
    expect(withLoop(on, false)).toEqual(t);
    expect("loop" in withLoop(on, false)).toBe(false);
  });
  it("switching off then on with a previous loop restores what was typed, not the defaults", () => {
    const on = withLoop(t, true);
    const typed = patchLoop(withCheckTimeout(withCheck(on, "pnpm test"), "120"), {
      stopCriteria: "done",
      followUp: "go",
      maxIterations: 9,
    });
    const off = withLoop(typed, false);
    expect(withLoop(off, true, typed.loop)).toEqual(typed);
    // No previous loop to restore: falls back to the defaults, same as the first switch-on.
    expect(withLoop(off, true).loop).toEqual(DEFAULT_LOOP);
  });
  it("patches loop fields, and ignores a task that does not loop", () => {
    expect(patchLoop(withLoop(t, true), { maxIterations: 9 }).loop!.maxIterations).toBe(9);
    expect(patchLoop(t, { maxIterations: 9 })).toBe(t);
  });
  it("a blank check command removes the check and its timeout", () => {
    const checked = withCheckTimeout(withCheck(withLoop(t, true), "pnpm test"), "120");
    expect(checked.loop).toMatchObject({ check: "pnpm test", checkTimeoutSec: 120 });
    const cleared = withCheck(checked, "  ");
    expect("check" in cleared.loop!).toBe(false);
    expect("checkTimeoutSec" in cleared.loop!).toBe(false);
  });
  it("an empty timeout returns to the default", () => {
    const checked = withCheckTimeout(withCheck(withLoop(t, true), "pnpm test"), "120");
    expect("checkTimeoutSec" in withCheckTimeout(checked, "").loop!).toBe(false);
  });
  it("withMaxIterations only patches a finite number, never writing 0 for a blank or non-numeric input", () => {
    const looped = withLoop(t, true);
    expect(withMaxIterations(looped, "9").loop!.maxIterations).toBe(9);
    expect(withMaxIterations(looped, "").loop!.maxIterations).toBe(DEFAULT_LOOP.maxIterations);
    expect(withMaxIterations(looped, "abc").loop!.maxIterations).toBe(DEFAULT_LOOP.maxIterations);
    expect(withMaxIterations(t, "9")).toBe(t);
  });
});
