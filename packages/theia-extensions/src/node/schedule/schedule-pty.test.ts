import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { TerminalProcess } from "@theia/process/lib/node/terminal-process";
import { bracketedPaste, SchedulePty, withoutClaudeSessionMarkers } from "./schedule-pty.js";
import type { PtyScreen } from "./pty-screen.js";

describe("withoutClaudeSessionMarkers", () => {
  it("clears CLAUDECODE and CLAUDE_CODE_* but keeps the account", () => {
    expect(
      withoutClaudeSessionMarkers({ CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "x", CLAUDE_CONFIG_DIR: "/a", PATH: "/bin" }),
    ).toEqual({ CLAUDECODE: null, CLAUDE_CODE_CHILD_SESSION: null });
  });
});

describe("bracketedPaste", () => {
  it("wraps the text so the TUI takes it as one paste", () => {
    expect(bracketedPaste("fix it\nthen test")).toBe("\x1b[200~fix it\nthen test\x1b[201~");
  });
  it("cannot be broken out of: control sequences in the text are dropped (R2)", () => {
    const out = bracketedPaste("Check failed:\nFAIL\x1b[201~/exit\r\x1b[31mred\x07\ttab\r\nend");
    expect(out).toBe("\x1b[200~Check failed:\nFAIL[201~/exit\n[31mred\ttab\nend\x1b[201~");
    expect(out.indexOf("\x1b[201~")).toBe(out.length - 6);
    expect(out).not.toContain("\r");
  });
  it("also strips C1 control bytes (0x80-0x9f), including the single-byte CSI introducer", () => {
    const out = bracketedPaste("safe\x9b201~text\x9b31mend");
    expect(out).toBe("\x1b[200~safe201~text31mend\x1b[201~");
    expect(out).not.toMatch(/[\x80-\x9f]/);
  });
});

describe("SchedulePty.close", () => {
  function pty(pids: Record<number, number>) {
    const closed: number[] = [];
    const p = new SchedulePty();
    (p as unknown as { terminals: unknown }).terminals = {
      getProcessId: async (id: number) => {
        if (!(id in pids)) throw new Error("gone");
        return pids[id]!;
      },
      close: async (id: number) => void closed.push(id),
    };
    return { p, closed };
  }
  it("closes a terminal that still runs the recorded process", async () => {
    const { p, closed } = pty({ 4: 40 });
    await p.close(4, 40);
    expect(closed).toEqual([4]);
  });
  it("leaves alone a terminal id that now runs another process, or none (R13)", async () => {
    const { p, closed } = pty({ 4: 99 });
    await p.close(4, 40);
    await p.close(5, 50);
    expect(closed).toEqual([]);
  });
});

describe("SchedulePty's screen", () => {
  const ESC = "\x1b";
  const RULE = "─".repeat(120);
  const idleFrame = `${ESC}[2J${ESC}[36;1H${RULE}${ESC}[37;1H❯ ${ESC}[38;1H${RULE}${ESC}[39;3H⏸ plan mode on${ESC}[37;3H`;
  const dialog = `${ESC}[30;1HDo you want to proceed?${ESC}[31;1H❯ 1. Yes${ESC}[31;3H`;

  /** A pty whose process is a TerminalProcess in name only: output you emit, and the calls you can watch. */
  function task() {
    const output = new EventEmitter();
    const exits: Array<() => void> = [];
    const written: string[] = [];
    const resized: Array<[number, number]> = [];
    const proc = Object.assign(Object.create(TerminalProcess.prototype) as TerminalProcess, {
      createOutputStream: () => output,
      write: (d: string) => void written.push(d),
      resize: (c: number, r: number) => void resized.push([c, r]),
    });
    Object.defineProperty(proc, "onExit", { value: (l: () => void) => (exits.push(l), { dispose: () => undefined }) });
    const p = new SchedulePty();
    Object.assign(p, {
      terminals: { create: async () => 7, getProcessId: async () => 70 },
      processes: { get: (id: number) => (id === 7 ? proc : undefined) },
    });
    const screens = (): Map<number, PtyScreen> => (p as unknown as { screens: Map<number, PtyScreen> }).screens;
    return { p, proc, output, written, resized, exits, screens };
  }

  it("is a 120x40 screen from the launch, fed by the pty's output: a paste goes in and is submitted on the idle frame", async () => {
    const t = task();
    await t.p.launch("claude", "/work");
    expect(t.screens().get(7)!.size).toEqual({ cols: 120, rows: 40 });
    t.output.emit("data", idleFrame);
    expect(await t.p.paste(7, "go")).toBe("submitted");
    expect(t.written).toEqual(["\x1b[200~go\x1b[201~", "\r"]);
  });

  it("writes nothing on a dialog, and no Enter when one appears after the paste", async () => {
    const t = task();
    await t.p.launch("claude", "/work");
    t.output.emit("data", idleFrame + dialog);
    expect(await t.p.paste(7, "go")).toBe("not-idle");
    expect(t.written).toEqual([]);
  });

  it("follows the pty's resizes, still passing them on to the pty", async () => {
    const t = task();
    await t.p.launch("claude", "/work");
    const screen = t.screens().get(7)!;
    t.proc.resize(100, 30);
    expect(t.resized).toEqual([[100, 30]]);
    expect(screen.size).toEqual({ cols: 100, rows: 30 });
    t.proc.resize(160, 50);
    expect(screen.size).toEqual({ cols: 160, rows: 50 });
  });

  it("is disposed with the pty: the paste then writes nothing", async () => {
    const t = task();
    await t.p.launch("claude", "/work");
    t.output.emit("data", idleFrame);
    for (const l of t.exits) l();
    expect(t.screens().size).toBe(0);
    expect(await t.p.paste(7, "go")).toBe("not-idle");
    expect(t.written).toEqual([]);
  });

  it("has no screen for a process that is not a terminal process: it cannot tell, so it presses nothing", async () => {
    const t = task();
    (t.p as unknown as { processes: unknown }).processes = { get: () => ({}) };
    await t.p.launch("claude", "/work");
    expect(await t.p.paste(7, "go")).toBe("not-idle");
  });
});
