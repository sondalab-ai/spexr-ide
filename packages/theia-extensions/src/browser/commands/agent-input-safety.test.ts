import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Workspace content (a spec, a TODO, a check's output) reaches the agent's TUI through these flows, and a cloned repository controls it.
describe("what the commands type into the agent", () => {
  const commands = code("./spexr-commands-contribution.ts");

  it("sends every prompt through the one paste writer: six callers, none with its own write", () => {
    expect(commands.match(/this\.pasteToAgent\(/g)).toHaveLength(6);
    expect(commands).not.toMatch(/sendAndSubmit/);
    expect(commands).not.toMatch(/claudeTerminal\.send\(/);
  });

  it("presses no Enter: the paste writer is bracketed, brings the terminal forward and writes nothing after", () => {
    const writer = /private async pasteToAgent[\s\S]*?\n  }/.exec(commands)![0];
    expect(writer).toMatch(/pasteIntoAgent\(prompt\)/);
    expect(writer).not.toMatch(/\\r|setTimeout/);
    expect(writer.indexOf("isTrusted()")).toBeGreaterThan(-1);
    expect(writer.indexOf("isTrusted()")).toBeLessThan(writer.indexOf("pasteIntoAgent"));
  });

  it("leaves the agent terminal manager no raw write: no send(), no Enter, no Shift+Tab", () => {
    const manager = code("../agent/claude-terminal-manager.ts");
    expect(manager).not.toMatch(/^\s*send\(text: string\)/m);
    expect(manager).not.toMatch(/sendText\("\\r"\)|SHIFT_TAB/);
  });

  it("has the schedule runner's one unattended Enter use the shared sanitiser and wait for an idle prompt", () => {
    const screen = read("../../node/schedule/pty-screen.ts");
    expect(screen).toMatch(/from "\.\.\/\.\.\/common\/terminal-paste\.js"/);
    expect(screen).toMatch(/unattended/);
    expect(code("../../node/schedule/pty-screen.ts")).toMatch(/if \(!idle\(\)\) return "not-idle";[\s\S]*?if \(!idle\(\)\) return "left-in-input";[\s\S]*?write\("\\r"\)/);
    expect(read("../../node/schedule/schedule-pty.ts")).toMatch(/from "\.\/pty-screen\.js"/);
  });
});

describe("workspace trust", () => {
  it("is asked before a Dark Factory session is created or re-attached, and before a scheduled run", () => {
    const manager = code("../darkfactory/darkfactory-terminal-manager.ts");
    expect(/private async create[\s\S]*?this\.trusted\(\)/.test(manager)).toBe(true);
    expect(/async reattach[\s\S]*?this\.trusted\(\)/.test(manager)).toBe(true);
    const wall = code("../darkfactory/darkfactory-wall-widget.tsx");
    expect(/private async runSchedule[\s\S]*?terminals\.trusted\(\)/.test(wall)).toBe(true);
    expect(/private async retryTask[\s\S]*?terminals\.trusted\(\)/.test(wall)).toBe(true);
  });

  it("warns, and stops nothing, when trust is withdrawn while the agent or a scheduled task runs", () => {
    const watcher = code("../darkfactory/trust-revocation-contribution.ts");
    expect(watcher).toMatch(/onDidChangeTrust\(\(trusted\) => \{\s*if \(!trusted\) void this\.warn\(\)/);
    expect(watcher).not.toMatch(/\.kill\(|\.close\(|dispose\(/);
    expect(code("../spexr-frontend-module.ts")).toMatch(/toService\(SpexrTrustRevocationContribution\)/);
  });

  it("is asked before the agent terminal adopts a terminal restored from the layout", () => {
    expect(code("../agent/claude-terminal-manager.ts")).toMatch(/\(await this\.isTrusted\(\)\) && \(await isTerminalLive\(existing\)\)/);
  });
});
