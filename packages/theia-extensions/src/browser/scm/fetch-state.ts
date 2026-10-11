/**
 * The fetch outcome and the fetch queue of one repository (S6d, S3). Pure, so
 * the transitions and the ordering are tested apart from Theia.
 */

/**
 * The longest a fetch may take before it counts as failed, a little over the
 * backend's own limit (20 s background, 120 s by hand: it kills git first, so
 * the queue is never freed while git still runs). A fetch by hand has the
 * longer one, since the user may be answering an authentication prompt.
 */
export const BACKGROUND_FETCH_TIMEOUT_MS = 30_000;
export const MANUAL_FETCH_TIMEOUT_MS = 150_000;

/** `promise`, rejecting with a timeout error if it has not settled in `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs fetches one at a time, so a fetch by hand never overlaps a background
 * one (they would race for git's lock, and the later outcome would overwrite
 * the earlier for the wrong reason). A fetch by hand asked for while one by
 * hand is running joins it rather than queueing another.
 */
export class FetchQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private manualInFlight: Promise<void> | undefined;

  /** Run `run` after everything queued before it; its result or failure is its own. */
  enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** A fetch by hand: queued behind any background fetch, and shared by callers that arrive while it runs. */
  manual(run: () => Promise<void>): Promise<void> {
    if (this.manualInFlight) return this.manualInFlight;
    const flight = this.enqueue(run).finally(() => {
      this.manualInFlight = undefined;
    });
    this.manualInFlight = flight;
    return flight;
  }
}

/** What the last fetches say about whether the branch is in step with its remote. */
export type FetchOutcome = "unknown" | "ok" | "failed";

/** What the coordinator runs and reports to. */
export interface FetchDeps {
  /** A fetch by hand: may ask for credentials; rejects on failure. */
  runManual(): Promise<void>;
  /** A background fetch: no prompts; rejects on failure. */
  runBackground(): Promise<void>;
  /** The outcome changed. */
  changed(): void;
  timeouts?: { manual: number; background: number };
  /** The clock, in ms; the system's by default. */
  now?: () => number;
}

/**
 * How long a manual success overrides the background fetches' failures: after
 * this long, or this many failed background ticks, it is spent. Without an end,
 * on a remote that needs credentials "synced" would outlive the network.
 */
export const MANUAL_SUCCESS_TTL_MS = 15 * 60_000;
export const MANUAL_SUCCESS_TICKS = 5;

/**
 * Fetching one repository (S6d, S3), free of Theia: a queue (a fetch by hand
 * never overlaps a background one, and a second click shares the first), a
 * timeout on each, and the outcome kept as two, so the unattended fetch cannot
 * undo what the user did. A background failure does not override a newer
 * manual success (on a remote that needs credentials the background fetch, run
 * with no prompts, fails every tick, while the user's own fetch worked) until
 * a newer manual attempt runs or a background fetch succeeds. The outcome is
 * "unknown" before any fetch and after a branch switch, which says nothing
 * about the other branch.
 */
export class FetchCoordinator {
  private readonly queue = new FetchQueue();
  private manualResult: "ok" | "failed" | undefined;
  private backgroundResult: "ok" | "failed" | undefined;
  private manualOkAt = 0;
  private failedTicksSinceManual = 0;

  constructor(private readonly deps: FetchDeps) {}

  /** The outcome as the bar should read it. */
  get outcome(): FetchOutcome {
    if (this.manualResult === "failed") return "failed";
    if (this.manualResult === "ok") return "ok";
    return this.backgroundResult ?? "unknown";
  }

  /** A fetch by hand; rejects with the fetch's own failure, after recording it. */
  manualFetch(): Promise<void> {
    const { manual } = this.deps.timeouts ?? { manual: MANUAL_FETCH_TIMEOUT_MS };
    return this.queue.manual(async () => {
      const before = this.outcome;
      try {
        await withTimeout(this.deps.runManual(), manual, "Fetch");
      } catch (err) {
        this.manualResult = "failed";
        this.announce(before);
        throw err;
      }
      this.manualResult = "ok";
      this.manualOkAt = (this.deps.now ?? Date.now)();
      this.failedTicksSinceManual = 0;
      this.announce(before);
    });
  }

  /** A background fetch, behind anything queued; never rejects. */
  backgroundFetch(): Promise<void> {
    const { background } = this.deps.timeouts ?? { background: BACKGROUND_FETCH_TIMEOUT_MS };
    return this.queue.enqueue(async () => {
      const before = this.outcome;
      try {
        await withTimeout(this.deps.runBackground(), background, "Background fetch");
        this.manualResult = undefined;
        this.backgroundResult = "ok";
      } catch {
        this.backgroundResult = "failed";
        this.expireManualSuccess();
      }
      this.announce(before);
    });
  }

  /** A manual success that has outlasted its time or its failed ticks no longer overrides the background's failure. */
  private expireManualSuccess(): void {
    if (this.manualResult !== "ok") return;
    this.failedTicksSinceManual++;
    if (this.failedTicksSinceManual >= MANUAL_SUCCESS_TICKS || (this.deps.now ?? Date.now)() - this.manualOkAt >= MANUAL_SUCCESS_TTL_MS) this.manualResult = undefined;
  }

  /** A branch switch: the other branch's fetches say nothing about this one. */
  reset(): void {
    const before = this.outcome;
    this.manualResult = undefined;
    this.backgroundResult = undefined;
    this.announce(before);
  }

  private announce(before: FetchOutcome): void {
    if (this.outcome !== before) this.deps.changed();
  }
}

/**
 * A refreshed status arriving at a repository (S6d): when it is the same as
 * the held one nothing happens; otherwise it is stored and then, if the branch
 * changed, the fetch outcome is reset, in that order, so a listener that reads
 * the status when the outcome changes sees the new branch's. Returns whether it
 * was stored.
 */
export function applyStatus<S extends { branch: string }>(
  current: S | undefined,
  next: S,
  same: (a: S | undefined, b: S) => boolean,
  hooks: { store(status: S): void; resetFetch(): void },
): boolean {
  const switched = current !== undefined && current.branch !== next.branch;
  if (same(current, next)) return false;
  hooks.store(next);
  if (switched) hooks.resetFetch();
  return true;
}
