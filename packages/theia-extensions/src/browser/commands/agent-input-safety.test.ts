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

  it("has the schedule runner use the shared sanitiser, and says its Enter is deliberate", () => {
    const raw = read("../../node/schedule/schedule-pty.ts");
    expect(raw).toMatch(/from "\.\.\/\.\.\/common\/terminal-paste\.js"/);
    expect(raw).toMatch(/unattended/);
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

  it("is asked before the agent terminal adopts a terminal restored from the layout", () => {
    expect(code("../agent/claude-terminal-manager.ts")).toMatch(/\(await this\.isTrusted\(\)\) && \(await isTerminalLive\(existing\)\)/);
  });
});
