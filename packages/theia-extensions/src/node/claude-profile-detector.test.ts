import { describe, expect, it, vi } from "vitest";
import {
  parseClaudeProfiles,
  parseFishProfiles,
  parsePowershellProfiles,
  resolveClaudeExecutableViaShell,
  resetClaudeShellProbeCache,
} from "./claude-profile-detector.js";
import * as os from "os";
import * as path from "path";

const home = os.homedir();

// The login-shell probe must stay async (a sync execFileSync blocked the backend
// event loop ~1.3s). Delayed callback so the promise cannot settle synchronously.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    execFile: vi.fn((_file: string, _args: readonly string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      setImmediate(() => cb(null, `${process.execPath}\n`));
    }),
  };
});

describe("parseClaudeProfiles — posix", () => {
  it("extracts a single-quoted alias with CLAUDE_CONFIG_DIR", () => {
    const text = `alias claude-perso='CLAUDE_CONFIG_DIR=~/.claude-perso claude'`;
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("claude-perso");
    expect(result[0]?.configDir).toBe(path.join(home, ".claude-perso"));
  });

  it("extracts a double-quoted alias with CLAUDE_CONFIG_DIR", () => {
    const text = `alias claude-work="CLAUDE_CONFIG_DIR=/opt/.claude-work claude --dangerously-skip-permissions"`;
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("claude-work");
    expect(result[0]?.configDir).toBe("/opt/.claude-work");
  });

  it("expands $HOME prefix", () => {
    const text = `alias claude-dev='CLAUDE_CONFIG_DIR=$HOME/.claude-dev claude'`;
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(1);
    expect(result[0]?.configDir).toBe(path.join(home, ".claude-dev"));
  });

  it("ignores aliases that don't invoke claude", () => {
    const text = `alias myprog='CLAUDE_CONFIG_DIR=~/.claude-x python main.py'`;
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(0);
  });

  it("ignores aliases without CLAUDE_CONFIG_DIR even if they call claude", () => {
    const text = `alias claude-plain='claude --dangerously-skip-permissions'`;
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no aliases are present", () => {
    const text = `# just a comment\nexport PATH="$PATH:/usr/local/bin"`;
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(0);
  });

  it("extracts multiple aliases from a realistic zshrc", () => {
    const text = [
      `export EDITOR=vim`,
      `alias ll='ls -la'`,
      `alias claude-perso='CLAUDE_CONFIG_DIR=~/.claude-perso claude'`,
      `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'`,
      `alias gs='git status'`,
    ].join("\n");
    const result = parseClaudeProfiles(text, "posix");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.label)).toEqual(["claude-perso", "claude-work"]);
  });
});

describe("parseClaudeProfiles — fish", () => {
  it("extracts a fish alias", () => {
    const text = `alias claude-perso 'CLAUDE_CONFIG_DIR=~/.claude-perso claude'`;
    const result = parseClaudeProfiles(text, "fish");
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("claude-perso");
    expect(result[0]?.configDir).toBe(path.join(home, ".claude-perso"));
  });

  it("extracts a fish function with set -x", () => {
    const text = [
      `function claude-work`,
      `    set -x CLAUDE_CONFIG_DIR ~/.claude-work`,
      `    claude $argv`,
      `end`,
    ].join("\n");
    const result = parseFishProfiles(text);
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("claude-work");
    expect(result[0]?.configDir).toBe(path.join(home, ".claude-work"));
  });

  it("returns empty array when no claude-related aliases exist", () => {
    const text = `alias ll 'ls -la'\nset -x EDITOR vim`;
    const result = parseClaudeProfiles(text, "fish");
    expect(result).toHaveLength(0);
  });
});

describe("parseClaudeProfiles — powershell", () => {
  it("extracts a PowerShell function with $env:CLAUDE_CONFIG_DIR", () => {
    const text = [
      `function claude-perso {`,
      `    $env:CLAUDE_CONFIG_DIR='C:\\Users\\u\\.claude-perso'; claude @args`,
      `}`,
    ].join("\n");
    const result = parseClaudeProfiles(text, "powershell");
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("claude-perso");
    expect(result[0]?.configDir).toBe("C:\\Users\\u\\.claude-perso");
  });

  it("ignores PowerShell functions that don't invoke claude", () => {
    const text = `function Do-Work { $env:CLAUDE_CONFIG_DIR='~/.x'; Write-Output "hi" }`;
    const result = parsePowershellProfiles(text);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no matching functions exist", () => {
    const text = `# PowerShell profile\nSet-Alias ll Get-ChildItem`;
    const result = parseClaudeProfiles(text, "powershell");
    expect(result).toHaveLength(0);
  });
});

describe("resolveClaudeExecutableViaShell", () => {
  it("returns before the probe settles — non-blocking (regression: a sync probe stalled the backend)", async () => {
    resetClaudeShellProbeCache();
    let settled = false;
    const p = resolveClaudeExecutableViaShell();
    void p.then(() => {
      settled = true;
    });
    await Promise.resolve(); // drain microtasks only — no loop turn
    expect(settled).toBe(false);
    expect(await p).toBe(process.execPath);
  });

  it("memoizes the probe for the process lifetime", async () => {
    resetClaudeShellProbeCache();
    const cp = await import("node:child_process");
    const calls = vi.mocked(cp.execFile).mock.calls.length;
    await resolveClaudeExecutableViaShell();
    await resolveClaudeExecutableViaShell();
    expect(vi.mocked(cp.execFile).mock.calls.length).toBe(calls + 1);
  });
});
