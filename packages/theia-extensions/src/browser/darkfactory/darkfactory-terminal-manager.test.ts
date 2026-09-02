import { describe, expect, it } from "vitest";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";

const UUID = "0f8f1a2b-3c4d-5e6f-9a0b-1c2d3e4f5a6b";
const SES = "ses_abc123XYZ";

interface NewTerminalCall {
  options: Record<string, unknown>;
}

function makeManager(): { manager: SpexrDarkfactoryTerminalManager; calls: NewTerminalCall[] } {
  const calls: NewTerminalCall[] = [];
  const manager = new SpexrDarkfactoryTerminalManager();
  (manager as unknown as { terminalService: unknown }).terminalService = {
    newTerminal: (options: Record<string, unknown>) => {
      calls.push({ options });
      return {
        start: async () => {},
        isDisposed: false,
        onDidDispose: () => {},
      };
    },
  };
  (manager as unknown as { preferences: unknown }).preferences = { get: () => "" };
  return { manager, calls };
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
    const { manager } = makeManager();
    const term = await manager.openEmbedded(UUID, "/Users/x/proj", "", false);
    (term as unknown as { isDisposed: boolean }).isDisposed = true;
    expect(manager.live(UUID)).toBeUndefined();
  });
});
