import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { BackendApplicationContribution } from "@theia/core/lib/node/backend-application";
import type { PowerState, SpexrPowerService } from "../../common/power-protocol.js";
import { nextSaving, readBattery, type BatteryReading } from "./battery.js";

/** How often the battery is read. */
export const POWER_POLL_MS = 20_000;

export interface PowerServiceDeps {
  readonly read: () => Promise<BatteryReading | undefined>;
  readonly pollMs: number;
}

/**
 * Reads the battery every {@link POWER_POLL_MS} and decides whether SPEXR
 * saves power (see `nextSaving` for the thresholds). Windows ask for the
 * state with `state()`; backend features follow `onDidChangeSaving`.
 */
@injectable()
export class SpexrPowerBackendService implements SpexrPowerService, BackendApplicationContribution {
  private readonly deps: PowerServiceDeps;
  private current: PowerState = { saving: false, level: undefined, onBattery: false };
  private readonly savingChanged = new Emitter<boolean>();
  private timer: ReturnType<typeof setInterval> | undefined;

  readonly onDidChangeSaving: Event<boolean> = this.savingChanged.event;

  constructor(@unmanaged() deps: Partial<PowerServiceDeps> = {}) {
    this.deps = { read: deps.read ?? (() => readBattery()), pollMs: deps.pollMs ?? POWER_POLL_MS };
  }

  get saving(): boolean {
    return this.current.saving;
  }

  initialize(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.deps.pollMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  onStop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async state(): Promise<PowerState> {
    return this.current;
  }

  /** Read the battery once and announce a change of saving. */
  async refresh(): Promise<void> {
    const reading = await this.deps.read();
    const saving = nextSaving(this.current.saving, reading);
    const changed = saving !== this.current.saving;
    this.current = { saving, level: reading?.level, onBattery: reading?.onBattery ?? false };
    if (changed) this.savingChanged.fire(saving);
  }
}

/** The backend features power saving switches off, as the coordinator sees them. */
export interface PowerSaveTargets {
  pauseRunningJobs(): Promise<string[]>;
  resumeDescriptionJob(root: string): Promise<void>;
  setPollingPaused(paused: boolean): void;
}

/**
 * Apply power saving to the backend: pause the description jobs that were
 * running and the Dark Factory rescan, and on the way back resume exactly
 * the jobs it paused. Returns the subscription.
 */
export function followPowerSaving(power: SpexrPowerBackendService, targets: PowerSaveTargets): { dispose(): void } {
  let saving = false;
  let pausedRoots: string[] = [];
  return power.onDidChangeSaving(async (next) => {
    saving = next;
    targets.setPollingPaused(next);
    if (next) {
      const roots = await targets.pauseRunningJobs();
      // Power may have come back while the jobs were pausing.
      if (saving) pausedRoots.push(...roots);
      else for (const root of roots) void targets.resumeDescriptionJob(root);
    } else {
      const roots = pausedRoots;
      pausedRoots = [];
      for (const root of roots) void targets.resumeDescriptionJob(root);
    }
  });
}
