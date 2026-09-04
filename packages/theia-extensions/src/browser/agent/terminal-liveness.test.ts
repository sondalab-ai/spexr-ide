import { describe, expect, it, vi } from "vitest";
import {
  INVALID_TERMINAL_ID,
  isLiveTerminalId,
  isTerminalLive,
  type TerminalLivenessSource,
} from "./terminal-liveness.js";

/** A terminal whose id can change and whose two open outcomes can be fired by hand. */
function fakeTerminal(terminalId: number): TerminalLivenessSource & {
  fireOpen(): void;
  fireFailure(): void;
  setId(id: number): void;
  listeners: { open: number; failure: number };
} {
  const open: (() => void)[] = [];
  const failure: (() => void)[] = [];
  let id = terminalId;
  return {
    get terminalId() {
      return id;
    },
    setId: (next: number) => {
      id = next;
    },
    onDidOpen: (l) => {
      open.push(l);
      return {
        dispose: () => {
          open.splice(open.indexOf(l), 1);
        },
      };
    },
    onDidOpenFailure: (l) => {
      failure.push(l);
      return {
        dispose: () => {
          failure.splice(failure.indexOf(l), 1);
        },
      };
    },
    fireOpen: () => open.forEach((l) => l()),
    fireFailure: () => failure.forEach((l) => l()),
    listeners: {
      get open() {
        return open.length;
      },
      get failure() {
        return failure.length;
      },
    } as { open: number; failure: number },
  };
}

describe("isLiveTerminalId", () => {
  it("treats -1 as the dead id and any other number as live", () => {
    expect(isLiveTerminalId(INVALID_TERMINAL_ID)).toBe(false);
    expect(isLiveTerminalId(0)).toBe(true);
    expect(isLiveTerminalId(7)).toBe(true);
  });
});

describe("isTerminalLive", () => {
  it("answers immediately for a terminal that already has a process", async () => {
    await expect(isTerminalLive(fakeTerminal(7))).resolves.toBe(true);
  });

  it("waits out an attach still in flight and reports success", async () => {
    const term = fakeTerminal(INVALID_TERMINAL_ID);
    const pending = isTerminalLive(term, 10_000);
    term.setId(4);
    term.fireOpen();
    await expect(pending).resolves.toBe(true);
  });

  it("reports failure as soon as the attach fails, without waiting for the timeout", async () => {
    const term = fakeTerminal(INVALID_TERMINAL_ID);
    const pending = isTerminalLive(term, 10_000);
    term.fireFailure();
    await expect(pending).resolves.toBe(false);
  });

  it("falls back to the id when the outcome fired before anyone subscribed", async () => {
    // The regression: a layout-restored agent terminal whose attach already
    // failed keeps terminalId -1 and never fires again, so the timeout must
    // re-read the id rather than hang or assume it is alive.
    vi.useFakeTimers();
    try {
      const dead = isTerminalLive(fakeTerminal(INVALID_TERMINAL_ID), 50);
      const alive = isTerminalLive(fakeTerminal(3), 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(dead).resolves.toBe(false);
      await expect(alive).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribes once settled, so a later event cannot resolve it twice", async () => {
    const term = fakeTerminal(INVALID_TERMINAL_ID);
    const pending = isTerminalLive(term, 10_000);
    term.fireFailure();
    await expect(pending).resolves.toBe(false);
    expect(term.listeners.open).toBe(0);
    expect(term.listeners.failure).toBe(0);
    term.fireOpen(); // no listeners left: must not throw or change the answer
    await expect(pending).resolves.toBe(false);
  });
});
