import { pollAction } from "./resource-poll-gate.js";

/** What the poller reads from and does to the outside, so the loop is tested apart from Theia. */
export interface PollerDeps<U> {
  /** One sample from the backend; undefined where usage cannot be measured. */
  sample(): Promise<U | undefined>;
  show(usage: U): void;
  clear(): void;
  /** How long until the next sample. */
  interval(): number;
  /** Whether the window is hidden (a hidden window skips its turn). */
  hidden(): boolean;
  schedule(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/**
 * The resource meter's polling loop (S6d, D14), driven by the preference. Each
 * start opens a generation and each stop closes it; a sample that comes back
 * after its generation closed is dropped and its loop ends. So turning the
 * meter off and on again while a sample is in flight leaves exactly one loop,
 * and a stale sample never shows.
 */
export class ResourcePoller<U> {
  private generation = 0;
  private running = false;
  private timer: unknown;

  constructor(private readonly deps: PollerDeps<U>) {}

  /** Follow the preference: start when turned on while idle, stop when turned off while running. */
  setEnabled(enabled: boolean): void {
    const action = pollAction(enabled, this.running);
    if (action === "start") {
      this.running = true;
      void this.poll(++this.generation);
    } else if (action === "stop") {
      this.stop();
    }
  }

  /** Stop: the loop in flight, if any, ends at its next check, and the entry goes. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation++;
    if (this.timer !== undefined) this.deps.cancel(this.timer);
    this.timer = undefined;
    this.deps.clear();
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (!this.deps.hidden()) {
      const usage = await this.deps.sample();
      if (generation !== this.generation) return;
      if (usage !== undefined) this.deps.show(usage);
      else this.deps.clear();
    }
    if (generation !== this.generation) return;
    this.timer = this.deps.schedule(() => void this.poll(generation), this.deps.interval());
  }
}
