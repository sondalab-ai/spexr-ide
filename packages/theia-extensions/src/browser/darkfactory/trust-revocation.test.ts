import { describe, expect, it } from "vitest";
import type { ScheduleSnapshot } from "../../common/schedule/schedule-protocol.js";
import { runningScheduledTasks, trustRevokedMessage } from "./trust-revocation.js";

const snap = (runStatus: string, ...tasks: string[]): ScheduleSnapshot =>
  ({ schedules: [], runs: { s: { status: runStatus, tasks: Object.fromEntries(tasks.map((t, i) => [`t${i}`, { status: t }])) } } }) as unknown as ScheduleSnapshot;

describe("runningScheduledTasks", () => {
  it("counts the tasks still active in a run that is running", () => {
    expect(runningScheduledTasks(snap("running", "running", "waiting-on-you", "converged", "failed", "checking"))).toBe(3);
  });

  it("counts nothing for a finished or aborted run, or no runs", () => {
    expect(runningScheduledTasks(snap("finished", "running"))).toBe(0);
    expect(runningScheduledTasks({ schedules: [], runs: {} })).toBe(0);
  });
});

describe("trustRevokedMessage", () => {
  it("is nothing when nothing runs", () => {
    expect(trustRevokedMessage({ agent: false, scheduledTasks: 0 })).toBeUndefined();
  });

  it("names the agent, the scheduled tasks, or both, says nothing was stopped and that no new session starts", () => {
    expect(trustRevokedMessage({ agent: true, scheduledTasks: 0 })).toBe("This workspace is no longer trusted, but the agent is still running. Nothing was stopped; no new session will start.");
    expect(trustRevokedMessage({ agent: false, scheduledTasks: 1 })).toContain("1 scheduled task is still running");
    expect(trustRevokedMessage({ agent: false, scheduledTasks: 2 })).toContain("2 scheduled tasks are still running");
    expect(trustRevokedMessage({ agent: true, scheduledTasks: 2 })).toContain("the agent and 2 scheduled tasks are still running");
  });
});
