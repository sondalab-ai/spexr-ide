import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "./schedule-types.js";
import { buildTaskArgs } from "./task-args.js";

const t = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: "t", name: "T", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p", ...o,
});

describe("buildTaskArgs", () => {
  it("claude: session id, model, permission mode, then the prompt last", () => {
    expect(buildTaskArgs(t({ model: "sonnet", permissionMode: "acceptEdits" }), "Go.", "u-1")).toEqual([
      "--session-id", "u-1", "--model", "sonnet", "--permission-mode", "acceptEdits", "Go.",
    ]);
  });
  it("opencode: model, --auto, --prompt", () => {
    expect(buildTaskArgs(t({ harness: "opencode", model: "a/b", permissionMode: "auto" }), "Go.")).toEqual([
      "-m", "a/b", "--auto", "--prompt", "Go.",
    ]);
  });
  it("claude without a session id is a programming error", () => {
    expect(() => buildTaskArgs(t({}), "Go.")).toThrow();
  });
});
