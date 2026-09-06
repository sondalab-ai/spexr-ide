// Structurally typed against Theia's TerminalWidget rather than importing it, so
// the liveness rule can be unit-tested without the browser DI runtime.

/** The id Theia reports for a terminal with no backend process (`IBaseTerminalServer.validateId`). */
export const INVALID_TERMINAL_ID = -1;

/** How long to let an in-flight attach settle before declaring a terminal dead. */
export const ATTACH_SETTLE_MS = 2000;

interface Unsubscribe {
  dispose(): void;
}

/** The part of `TerminalWidget` this needs: its id and its two open outcomes. */
export interface TerminalLivenessSource {
  readonly terminalId: number;
  onDidOpen(listener: () => void): Unsubscribe;
  onDidOpenFailure(listener: () => void): Unsubscribe;
}

/** Whether a terminal id refers to a live backend process. */
export function isLiveTerminalId(id: number): boolean {
  return typeof id === "number" && id !== INVALID_TERMINAL_ID;
}

/**
 * Whether a terminal has a live backend process, waiting out an attach that is
 * still in flight.
 *
 * A terminal restored from a saved layout re-attaches asynchronously, so its id
 * is not trustworthy the instant the widget appears. It is trustworthy once
 * `onDidOpen` or `onDidOpenFailure` has fired — but the restore may have
 * finished before anyone subscribed, which is why the timeout re-reads the id
 * rather than assuming either answer.
 *
 * The wait is bounded on purpose: this runs on the launch path, where an untimed
 * wait would strand every later step instead of merely delaying this one.
 */
export function isTerminalLive(
  term: TerminalLivenessSource,
  timeoutMs: number = ATTACH_SETTLE_MS,
): Promise<boolean> {
  if (isLiveTerminalId(term.terminalId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let open: Unsubscribe | undefined;
    let failure: Unsubscribe | undefined;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      open?.dispose();
      failure?.dispose();
      resolve(value);
    };
    open = term.onDidOpen(() => finish(true));
    failure = term.onDidOpenFailure(() => finish(false));
    timer = setTimeout(() => finish(isLiveTerminalId(term.terminalId)), timeoutMs);
  });
}

/** The part of `TerminalWidget` needed to decide whether a cached widget is still usable. */
export interface ReusableTerminal {
  readonly terminalId: number;
  readonly isDisposed: boolean;
}

/**
 * Whether a cached terminal widget can still carry input.
 *
 * `isDisposed` alone is not enough. When the frontend re-attaches after a
 * dropped connection and the backend process is gone, Theia only re-creates it
 * for `kind: "user"` terminals; ours carry their own kind for styling, so the
 * widget survives with `terminalId` -1 and opens a channel nothing serves. It
 * keeps showing its scrollback and silently swallows every keystroke, so a
 * manager that reuses it on `!isDisposed` alone caches a corpse forever.
 */
export function isReusableTerminal(term: ReusableTerminal): boolean {
  return !term.isDisposed && isLiveTerminalId(term.terminalId);
}

/** The part of `TerminalWidget` needed to learn that an attach attempt failed. */
export interface AttachFailureSource {
  onDidOpenFailure(listener: () => void): Unsubscribe;
}

/**
 * Run `evict` the first time a terminal reports a failed attach, so a manager
 * can drop it as soon as it dies rather than on the next lookup.
 *
 * This is the reconnect counterpart of {@link isTerminalLive}: `start()` fires
 * `onDidOpenFailure` before throwing, and on the reconnect path that throw is an
 * unhandled rejection nobody sees. Only the first failure is reported — a
 * terminal is evicted once.
 */
export function evictOnAttachFailure(term: AttachFailureSource, evict: () => void): Unsubscribe {
  let evicted = false;
  return term.onDidOpenFailure(() => {
    if (evicted) return;
    evicted = true;
    evict();
  });
}
