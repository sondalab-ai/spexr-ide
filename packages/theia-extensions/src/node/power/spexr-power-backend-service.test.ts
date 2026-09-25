import { describe, expect, it, vi } from "vitest";
import { SpexrPowerBackendService, followPowerSaving, type PowerSaveTargets } from "./spexr-power-backend-service.js";
import type { BatteryReading } from "./battery.js";

function serviceReading(readings: Array<BatteryReading | undefined>) {
  return new SpexrPowerBackendService({ read: async () => readings.shift(), pollMs: 1_000 });
}

describe("SpexrPowerBackendService", () => {
  it("reports the latest reading and fires only when saving changes", async () => {
    const svc = serviceReading([
      { level: 50, onBattery: true },
      { level: 18, onBattery: true },
      { level: 17, onBattery: true },
      { level: 17, onBattery: false },
    ]);
    const changes: boolean[] = [];
    svc.onDidChangeSaving((s) => changes.push(s));
    for (let i = 0; i < 4; i++) await svc.refresh();
    expect(changes).toEqual([true, false]);
    expect(await svc.state()).toEqual({ saving: false, level: 17, onBattery: false });
  });

  it("never saves on a machine without a battery", async () => {
    const svc = serviceReading([undefined]);
    await svc.refresh();
    expect(await svc.state()).toEqual({ saving: false, level: undefined, onBattery: false });
  });
});

describe("followPowerSaving", () => {
  it("pauses running jobs and the rescan, then resumes only the jobs it paused", async () => {
    const svc = serviceReading([{ level: 10, onBattery: true }, { level: 10, onBattery: false }]);
    const targets: PowerSaveTargets = {
      pauseRunningJobs: vi.fn(async () => ["/a"]),
      resumeDescriptionJob: vi.fn(async () => {}),
      setPollingPaused: vi.fn(),
    };
    followPowerSaving(svc, targets);
    await svc.refresh();
    await vi.waitFor(() => expect(targets.pauseRunningJobs).toHaveBeenCalledOnce());
    expect(targets.setPollingPaused).toHaveBeenLastCalledWith(true);
    await svc.refresh();
    expect(targets.setPollingPaused).toHaveBeenLastCalledWith(false);
    expect(targets.resumeDescriptionJob).toHaveBeenCalledExactlyOnceWith("/a");
  });

  it("resumes the jobs at once when power returns while they are still pausing", async () => {
    const svc = serviceReading([{ level: 10, onBattery: true }, { level: 10, onBattery: false }]);
    let release: (roots: string[]) => void = () => {};
    const targets: PowerSaveTargets = {
      pauseRunningJobs: vi.fn(() => new Promise<string[]>((r) => (release = r))),
      resumeDescriptionJob: vi.fn(async () => {}),
      setPollingPaused: vi.fn(),
    };
    followPowerSaving(svc, targets);
    await svc.refresh();
    await svc.refresh();
    release(["/a"]);
    await vi.waitFor(() => expect(targets.resumeDescriptionJob).toHaveBeenCalledExactlyOnceWith("/a"));
  });
});
