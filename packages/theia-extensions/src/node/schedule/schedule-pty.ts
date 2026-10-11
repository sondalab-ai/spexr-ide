import { inject, injectable } from "@theia/core/shared/inversify";
import { FileUri } from "@theia/core/lib/common/file-uri";
import { IShellTerminalServer } from "@theia/terminal/lib/common/shell-terminal-protocol";
import { ProcessManager } from "@theia/process/lib/node/process-manager";
import { TerminalProcess } from "@theia/process/lib/node/terminal-process";
import { bracketedPaste } from "../../common/terminal-paste.js";
import { PtyScreen, pasteInto, type PasteOutcome } from "./pty-screen.js";

export { bracketedPaste };

/** A task pty's size at launch; the headless screen starts at the same. */
const LAUNCH_COLS = 120;
const LAUNCH_ROWS = 40;

/**
 * The terminal server merges the backend's environment into every pty. A SPEXR
 * started from inside a Claude Code session carries that session's markers, and
 * a Claude started with `CLAUDE_CODE_CHILD_SESSION` saves no transcript (probe,
 * 2026-09-27). A null value removes a variable in Theia's env merge.
 */
export function withoutClaudeSessionMarkers(env: NodeJS.ProcessEnv): Record<string, null> {
  const cleared: Record<string, null> = {};
  for (const key of Object.keys(env)) if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) cleared[key] = null;
  return cleared;
}

/**
 * Backend ptys for scheduled tasks, through the same terminal server the
 * frontend's terminals use: a window attaches to one by its terminal id.
 */
@injectable()
export class SchedulePty {
  @inject(IShellTerminalServer) private readonly terminals!: IShellTerminalServer;
  @inject(ProcessManager) private readonly processes!: ProcessManager;

  /** Each task pty's screen, kept for the idle-prompt gate on the follow-up's Enter (pty-screen.ts). */
  private readonly screens = new Map<number, PtyScreen>();

  /**
   * Keep a headless copy of a pty's screen: a reader of its own on the output,
   * so Theia's terminal stream is not touched; resized whenever the pty is
   * (Theia resizes it as a card attaches); disposed with the pty.
   */
  private followOutput(terminalId: number, cols: number, rows: number): void {
    const p = this.processes.get(terminalId);
    if (!(p instanceof TerminalProcess)) return;
    const screen = new PtyScreen(cols, rows);
    this.screens.set(terminalId, screen);
    p.createOutputStream().on("data", (chunk: unknown) => screen.write(String(chunk)));
    const resize = p.resize.bind(p);
    p.resize = (c: number, r: number) => {
      resize(c, r);
      screen.resize(c, r);
    };
    p.onExit(() => {
      screen.dispose();
      this.screens.delete(terminalId);
    });
  }

  /** The task's pty shows Claude Code's idle input prompt; false when it cannot tell (fails closed). */
  private async idle(terminalId: number): Promise<boolean> {
    return (await this.screens.get(terminalId)?.isIdle()) === true;
  }

  async launch(line: string, cwd: string): Promise<{ terminalId: number; processId: number }> {
    const terminalId = await this.terminals.create({
      args: ["-i", "-l", "-c", line],
      rootURI: FileUri.create(cwd).toString(),
      cols: LAUNCH_COLS,
      rows: LAUNCH_ROWS,
      env: withoutClaudeSessionMarkers(process.env),
    });
    if (terminalId < 0) throw new Error("The terminal server could not start the session.");
    this.followOutput(terminalId, LAUNCH_COLS, LAUNCH_ROWS);
    return { terminalId, processId: await this.terminals.getProcessId(terminalId) };
  }

  write(terminalId: number, data: string): void {
    const p = this.processes.get(terminalId);
    if (p instanceof TerminalProcess) p.write(data);
  }

  /**
   * Paste a follow-up into a task's TUI and submit it as one prompt, only
   * while the pty shows an idle input prompt (before the paste and before the
   * Enter): the outcome says when nothing, or no Enter, was written.
   */
  paste(terminalId: number, text: string): Promise<PasteOutcome> {
    return pasteInto(
      (data) => this.write(terminalId, data),
      text,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      () => this.idle(terminalId),
    );
  }

  /** Calls `listener` once the pty exits (at once when it is already gone). Returns an unsubscribe. */
  onExit(terminalId: number, listener: () => void): () => void {
    const p = this.processes.get(terminalId);
    if (!p) {
      queueMicrotask(listener);
      return () => {};
    }
    const d = p.onExit(() => listener());
    return () => d.dispose();
  }

  /**
   * End a task's session, but only while `terminalId` still runs `processId`:
   * terminal ids start over when the backend restarts, and another process's
   * terminal must never be closed (R13). Resolves either way.
   */
  async close(terminalId: number, processId: number): Promise<void> {
    const current = await this.terminals.getProcessId(terminalId).catch(() => -1);
    if (current === processId) await this.terminals.close(terminalId);
  }
}
