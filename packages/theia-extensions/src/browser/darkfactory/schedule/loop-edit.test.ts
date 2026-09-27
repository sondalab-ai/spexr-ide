import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "../../../common/schedule/schedule-types.js";
import { DEFAULT_LOOP, patchLoop, withCheck, withCheckTimeout, withLoop } from "./loop-edit.js";

const t: ScheduleTask = { id: "a", name: "A", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p" };

describe("loop editing", () => {
  it("switches the loop on with defaults, keeps it when already on, and drops every loop setting when off", () => {
    const on = withLoop(t, true);
    expect(on.loop).toEqual(DEFAULT_LOOP);
    expect(withLoop(on, true)).toBe(on);
    expect(withLoop(on, false)).toEqual(t);
    expect("loop" in withLoop(on, false)).toBe(false);
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
});
