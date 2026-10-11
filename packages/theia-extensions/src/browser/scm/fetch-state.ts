/**
 * The fetch outcome and the fetch queue of one repository (S6d, S3). Pure, so
 * the transitions and the ordering are tested apart from Theia.
 */

/** The longest a fetch may take before it counts as failed (a hung remote, a prompt nobody answers). */
export const FETCH_TIMEOUT_MS = 60_000;

/** `promise`, rejecting with a timeout error if it has not settled in `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Whether the last fetch failed. `record` and `reset` say whether that changed, so only a change is announced. */
export class FetchState {
  private failed = false;

  get isFailed(): boolean {
    return this.failed;
  }

  /** The outcome of a fetch, by hand or in the background. Returns whether the state changed. */
  record(failed: boolean): boolean {
    if (this.failed === failed) return false;
    this.failed = failed;
    return true;
  }

  /** Forget the outcome (a branch switch: the other branch's fetch says nothing about this one). Returns whether it changed. */
  reset(): boolean {
    return this.record(false);
  }
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
