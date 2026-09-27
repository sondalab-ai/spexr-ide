import { inject, injectable } from "@theia/core/shared/inversify";
import { FileUri } from "@theia/core/lib/common/file-uri";
import { IShellTerminalServer } from "@theia/terminal/lib/common/shell-terminal-protocol";
import { ProcessManager } from "@theia/process/lib/node/process-manager";
import { TerminalProcess } from "@theia/process/lib/node/terminal-process";

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

/** Wait between a paste and the Enter that submits it, so the TUI has taken the paste in (probe, 2026-09-27). */
export const PASTE_ENTER_DELAY_MS = 100;

/**
 * `text` as one bracketed paste. CR becomes LF, and every other control
 * character but LF and tab is dropped first — above all ESC, so `ESC[201~`
 * cannot end the paste early and turn the rest into keystrokes. The text can
 * carry a check's output, which comes from code the agent wrote.
 */
export function bracketedPaste(text: string): string {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  return `\x1b[200~${clean}\x1b[201~`;
}

/** Paste `text`, then press Enter once the TUI has taken the paste in. */
export async function pasteInto(
  write: (data: string) => void,
  text: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  write(bracketedPaste(text));
  await sleep(PASTE_ENTER_DELAY_MS);
  write("\r");
}

/**
 * Backend ptys for scheduled tasks, through the same terminal server the
 * frontend's terminals use: a window attaches to one by its terminal id.
 */
@injectable()
export class SchedulePty {
  @inject(IShellTerminalServer) private readonly terminals!: IShellTerminalServer;
  @inject(ProcessManager) private readonly processes!: ProcessManager;

  async launch(line: string, cwd: string): Promise<{ terminalId: number; processId: number }> {
    const terminalId = await this.terminals.create({
      args: ["-i", "-l", "-c", line],
      rootURI: FileUri.create(cwd).toString(),
      cols: 120,
      rows: 40,
      env: withoutClaudeSessionMarkers(process.env),
    });
    if (terminalId < 0) throw new Error("The terminal server could not start the session.");
    return { terminalId, processId: await this.terminals.getProcessId(terminalId) };
  }

  write(terminalId: number, data: string): void {
    const p = this.processes.get(terminalId);
    if (p instanceof TerminalProcess) p.write(data);
  }

  /** Paste a follow-up into a task's TUI and submit it as one prompt. */
  paste(terminalId: number, text: string): Promise<void> {
    return pasteInto(
      (data) => this.write(terminalId, data),
      text,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
}
