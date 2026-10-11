import { inject, injectable } from "@theia/core/shared/inversify";
import { FileUri } from "@theia/core/lib/common/file-uri";
import { IShellTerminalServer } from "@theia/terminal/lib/common/shell-terminal-protocol";
import { ProcessManager } from "@theia/process/lib/node/process-manager";
import { TerminalProcess } from "@theia/process/lib/node/terminal-process";
import { bracketedPaste } from "../../common/terminal-paste.js";
import { SCREEN_TAIL_CHARS, isIdlePrompt, pasteInto, screenRows, type PasteOutcome } from "./pty-screen.js";

export { bracketedPaste };

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

  /** Each task pty's recent output, kept for the idle-prompt gate on the follow-up's Enter (pty-screen.ts). */
  private readonly tails = new Map<number, string>();

  /** Keep the tail of a pty's output: a reader of its own, so Theia's terminal stream is not touched. */
  private followOutput(terminalId: number): void {
    const p = this.processes.get(terminalId);
    if (!(p instanceof TerminalProcess)) return;
    this.tails.set(terminalId, "");
    p.createOutputStream().on("data", (chunk: unknown) => {
      const text = ((this.tails.get(terminalId) ?? "") + String(chunk)).slice(-SCREEN_TAIL_CHARS);
      this.tails.set(terminalId, text);
    });
    p.onExit(() => this.tails.delete(terminalId));
  }

  /** The task's pty shows an idle input prompt and no dialog; false when it cannot tell (fails closed). */
  private idle(terminalId: number): boolean {
    const tail = this.tails.get(terminalId);
    return tail !== undefined && isIdlePrompt(screenRows(tail));
  }

  async launch(line: string, cwd: string): Promise<{ terminalId: number; processId: number }> {
    const terminalId = await this.terminals.create({
      args: ["-i", "-l", "-c", line],
      rootURI: FileUri.create(cwd).toString(),
      cols: 120,
      rows: 40,
      env: withoutClaudeSessionMarkers(process.env),
    });
    if (terminalId < 0) throw new Error("The terminal server could not start the session.");
    this.followOutput(terminalId);
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
