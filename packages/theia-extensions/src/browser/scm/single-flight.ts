/**
 * Runs an async operation at most once at a time. Calls arriving mid-flight
 * do not queue up — they mark the run dirty, and exactly one rerun follows.
 * Needed because refresh now has two independent triggers (workspace file
 * changes and repository pushes) that routinely fire together.
 */
export class SingleFlight {
  private inFlight: Promise<void> | undefined;
  private dirty = false;

  constructor(private readonly op: () => Promise<void>) {}

  run(): Promise<void> {
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    this.inFlight = this.cycle();
    return this.inFlight;
  }

  /** Resolves when the current run and any rerun it triggered are done. */
  async settled(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  private async cycle(): Promise<void> {
    try {
      await this.op();
      while (this.dirty) {
        this.dirty = false;
        await this.op();
      }
    } finally {
      this.inFlight = undefined;
    }
  }
}
