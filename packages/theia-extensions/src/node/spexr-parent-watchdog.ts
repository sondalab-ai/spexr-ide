import { injectable } from "@theia/core/shared/inversify";
import type { BackendApplicationContribution } from "@theia/core/lib/node/backend-application";

/** How often the orphan check runs, when the IPC channel is not the signal. */
export const PARENT_POLL_MS = 5_000;

/** The process surface the watchdog needs; `process` satisfies it. */
export interface WatchedProcess {
  readonly pid?: number | undefined;
  readonly ppid: number;
  readonly send?: unknown;
  on(event: "disconnect", listener: () => void): unknown;
  kill(pid: number, signal: string): unknown;
}

/**
 * Shuts the backend down when the Electron main process goes away.
 *
 * Theia kills the forked backend from `app.on('quit')` only
 * (`electron-main-application.ts`), so a main process that dies without a clean
 * quit — SIGKILL from a terminal, a crash, `pkill Electron` — leaves the backend
 * running forever, reparented to init. It keeps the Darkfactory scan, the model
 * worker and every agent terminal alive with it, and several of those
 * accumulating on one machine is enough to block the event loop for seconds.
 *
 * Two signals, because neither covers everything:
 *
 * - The IPC channel to the parent closing. Immediate and event-driven, and the
 *   normal case, since Theia forks the backend with an IPC channel.
 * - `process.ppid` becoming 1. Covers a parent that died without the channel
 *   reporting it, and the `--no-cluster` mode where there is no channel at all.
 *
 * It raises SIGTERM on itself rather than exiting: Theia's own shutdown handlers
 * are what stop the terminals and the model worker, and skipping them would just
 * move the orphans one level down.
 */
@injectable()
export class SpexrParentWatchdog implements BackendApplicationContribution {
  private timer: ReturnType<typeof setInterval> | undefined;

  initialize(): void {
    this.watch(process as unknown as WatchedProcess);
  }

  onStop(): void {
    this.stop();
  }

  /** Exposed for tests; `initialize` passes the real `process`. */
  watch(proc: WatchedProcess, pollMs = PARENT_POLL_MS): void {
    if (typeof proc.send === "function") {
      proc.on("disconnect", () => this.shutdown(proc));
    }
    this.timer = setInterval(() => {
      if (proc.ppid === 1) this.shutdown(proc);
    }, pollMs);
    // Do not hold the event loop open on this timer alone.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private shutdown(proc: WatchedProcess): void {
    this.stop();
    console.error("[spexr] parent process is gone — shutting the backend down");
    const pid = proc.pid;
    if (typeof pid === "number") proc.kill(pid, "SIGTERM");
  }
}
