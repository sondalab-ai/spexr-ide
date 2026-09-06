import { describe, expect, it } from "vitest";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";

const UUID = "0f8f1a2b-3c4d-5e6f-9a0b-1c2d3e4f5a6b";
const SES = "ses_abc123XYZ";

interface NewTerminalCall {
  options: Record<string, unknown>;
}

/** A terminal widget whose id, disposal and failed-attach event can be driven by hand. */
interface FakeTerminal {
  terminalId: number;
  isDisposed: boolean;
  start(): Promise<void>;
  dispose(): void;
  onDidDispose(listener: () => void): void;
  onDidOpenFailure(listener: () => void): { dispose(): void };
  /** Report the failure Theia fires when a re-attach finds no backend process. */
  failAttach(): void;
}

function fakeTerminal(): FakeTerminal {
  const disposeListeners: (() => void)[] = [];
  const failureListeners: (() => void)[] = [];
  const term: FakeTerminal = {
    terminalId: 1,
    isDisposed: false,
    start: async () => {},
    dispose: () => {
      term.isDisposed = true;
      disposeListeners.forEach((l) => l());
    },
    onDidDispose: (l) => {
      disposeListeners.push(l);
    },
    onDidOpenFailure: (l) => {
      failureListeners.push(l);
      return {
        dispose: () => {
          failureListeners.splice(failureListeners.indexOf(l), 1);
        },
      };
    },
    failAttach: () => {
      term.terminalId = -1;
      failureListeners.slice().forEach((l) => l());
    },
  };
  return term;
}

function makeManager(): {
  manager: SpexrDarkfactoryTerminalManager;
  calls: NewTerminalCall[];
  terms: FakeTerminal[];
} {
  const calls: NewTerminalCall[] = [];
  const terms: FakeTerminal[] = [];
  const manager = new SpexrDarkfactoryTerminalManager();
  (manager as unknown as { terminalService: unknown }).terminalService = {
    newTerminal: (options: Record<string, unknown>) => {
      calls.push({ options });
      const term = fakeTerminal();
      terms.push(term);
      return term;
    },
  };
  (manager as unknown as { preferences: unknown }).preferences = { get: () => "" };
  return { manager, calls, terms };
}

function shellLine(calls: NewTerminalCall[]): string {
  const args = calls[0]!.options.shellArgs as string[];
  return args[args.length - 1]!;
}

describe("SpexrDarkfactoryTerminalManager harness selection", () => {
  it("launches claude --resume with the config dir export for a UUID session", async () => {
    const { manager, calls } = makeManager();
    await manager.openEmbedded(UUID, "/Users/x/proj", "/Users/x/.claude", false);
    expect(calls).toHaveLength(1);
    expect(shellLine(calls)).toBe(
      `export CLAUDE_CONFIG_DIR='/Users/x/.claude'; cd '/Users/x/proj'; claude '--resume' '${UUID}'; exec "$SHELL" -i`,
    );
    expect(calls[0]!.options.env).toEqual({ CLAUDE_CONFIG_DIR: "/Users/x/.claude" });
  });

  it("adds --fork-session for a forked claude resume", async () => {
    const { manager, calls } = makeManager();
    await manager.openEmbedded(UUID, "/Users/x/proj", "", true);
    expect(shellLine(calls)).toContain(`claude '--resume' '${UUID}' '--fork-session'`);
  });

  it("launches opencode --session with a cd and no CLAUDE_CONFIG_DIR export", async () => {
    const { manager, calls } = makeManager();
    await manager.openEmbedded(SES, "/Users/x/proj", "", false);
    expect(calls).toHaveLength(1);
    expect(shellLine(calls)).toBe(`cd '/Users/x/proj'; opencode '--session' '${SES}'; exec "$SHELL" -i`);
    expect(calls[0]!.options.env).toEqual({});
  });

  it("adds --fork for a forked opencode resume", async () => {
    const { manager, calls } = makeManager();
    await manager.openEmbedded(SES, "/Users/x/proj", "", true);
    expect(shellLine(calls)).toBe(`cd '/Users/x/proj'; opencode '--session' '${SES}' '--fork'; exec "$SHELL" -i`);
  });

  it("reuses the running terminal instead of starting a second one", async () => {
    const { manager, calls } = makeManager();
    const first = await manager.openEmbedded(UUID, "/Users/x/proj", "", false);

    expect(await manager.openEmbedded(UUID, "/Users/x/proj", "", false)).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("returns undefined for an id no harness recognizes", async () => {
    const { manager, calls } = makeManager();
    await expect(manager.openEmbedded("not-an-id", "/Users/x/proj", "", false)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("returns undefined when the project path is empty", async () => {
    const { manager, calls } = makeManager();
    await expect(manager.openEmbedded(SES, "", "", false)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("SpexrDarkfactoryTerminalManager.live", () => {
  it("knows nothing about a session that was never opened", () => {
    const { manager } = makeManager();
    expect(manager.live(UUID)).toBeUndefined();
  });

  it("hands back the terminal opened for a session", async () => {
    const { manager } = makeManager();
    const term = await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    expect(manager.live(UUID)).toBe(term);
  });

  it("ignores a terminal that has been disposed", async () => {
    const { manager, terms } = makeManager();
    await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    terms[0]!.dispose();
    expect(manager.live(UUID)).toBeUndefined();
  });

  it("ignores a terminal left behind with no backend process", async () => {
    // The regression: after the frontend reconnects (standby, backend restart)
    // Theia re-attaches, finds no process and — because our terminals do not use
    // `kind: "user"` — leaves the widget alive with id -1. It kept rendering as
    // an interactive card that swallowed every keystroke.
    const { manager, terms } = makeManager();
    await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    terms[0]!.terminalId = -1;
    expect(manager.live(UUID)).toBeUndefined();
  });
});

describe("SpexrDarkfactoryTerminalManager eviction", () => {
  it("disposes the terminal as soon as a re-attach fails", async () => {
    const { manager, terms } = makeManager();
    await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    terms[0]!.failAttach();
    expect(terms[0]!.isDisposed).toBe(true);
    expect(manager.live(UUID)).toBeUndefined();
  });

  it("starts a fresh terminal for a session whose process is gone", async () => {
    const { manager, calls, terms } = makeManager();
    const first = await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    terms[0]!.failAttach();

    const second = await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    expect(calls).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(manager.live(UUID)).toBe(second);
  });

  it("starts a fresh terminal under a launch key whose process is gone", async () => {
    const { manager, calls, terms } = makeManager();
    const first = await manager.openNew("launch-1", "claude", "/Users/x/proj", "");
    terms[0]!.terminalId = -1;

    const second = await manager.openNew("launch-1", "claude", "/Users/x/proj", "");
    expect(calls).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(first).toBeDefined();
    expect(terms[0]!.isDisposed).toBe(true);
  });
});
