import { formatDuration } from "../agent-pane/agent-pane-format.js";
import { formatClock } from "../darkfactory/darkfactory-format.js";

/**
 * Terminal command blocks (S6l, D22), free of xterm and Theia: reading the
 * marks spexr's shell scripts print, deciding which of them to believe, and
 * what a block says. The terminal draws the rest (command-blocks-contribution.ts).
 *
 * The marks are OSC 133 payloads (`ESC ] 133 ; <payload> BEL`):
 *   spexr_hello;<nonce>                          once, when the shell starts
 *   spexr_finished;<nonce>;<exit>;<epoch ms>     after each command
 * The nonce is a shell variable the scripts never export, told once before any
 * command can run. What a command prints (a `cat` of a hostile file) can carry
 * any escape sequence but cannot know it, so it cannot forge a block.
 */

/** Theia's own OSC number for command marks, which spexr's marks ride beside. */
export const OSC_COMMAND_MARKS = 133;

const NONCE = /^[0-9a-f]{32}$/;
const HELLO = /^spexr_hello;([0-9a-f]{32})$/;
const FINISHED = /^spexr_finished;([0-9a-f]{32});(\d{1,3});(\d{12,14})$/;
/** A payload longer than this is never one of ours. */
const MAX_PAYLOAD = 96;

export type SpexrMark =
  | { readonly kind: "hello"; readonly nonce: string }
  | { readonly kind: "finished"; readonly nonce: string; readonly exit: number; readonly epochMs: number };

/** Whether a payload is in spexr's namespace, believed or not: such a payload is never passed on to Theia's handler. */
export const isSpexrPayload = (payload: string): boolean => payload.startsWith("spexr_");

/**
 * Strictly parse a payload: only the exact shapes above, a 32-digit hex nonce,
 * an exit code of at most 255 and a 12 to 14 digit epoch in ms. Anything else,
 * including anything with extra characters, is undefined.
 */
export function parseSpexrMark(payload: string): SpexrMark | undefined {
  if (payload.length > MAX_PAYLOAD) return undefined;
  const hello = HELLO.exec(payload);
  if (hello) return { kind: "hello", nonce: hello[1]! };
  const done = FINISHED.exec(payload);
  if (!done) return undefined;
  const exit = Number(done[2]);
  if (exit > 255 || !NONCE.test(done[1]!)) return undefined;
  return { kind: "finished", nonce: done[1]!, exit, epochMs: Number(done[3]) };
}

/** A position in the buffer that follows its line as the buffer scrolls and trims (xterm's marker); -1 once gone. */
export interface LineMarker {
  readonly line: number;
}

export interface RunningCommand<M extends LineMarker> {
  /** The marker of the prompt line the command was typed after: the block's first line. */
  readonly prompt: M | undefined;
  /** Stamped when the command started, in the terminal's own clock. */
  readonly startMs: number;
}

export interface FinishedBlock<M extends LineMarker> {
  readonly prompt: M | undefined;
  /** First line of the block and how many lines it holds, the prompt's line to the end of the output. */
  readonly lines: number;
  readonly startMs: number;
  readonly endMs: number;
  /** Undefined when the shell's clock and the terminal's disagree by more than a day. */
  readonly durationMs: number | undefined;
  readonly exit: number;
}

/** The longest a command may plausibly run, against a skewed clock. */
const MAX_DURATION_MS = 24 * 3_600_000;

/**
 * The state machine behind the blocks. Marks go in as the parser meets them;
 * it answers with the block a finished mark closes, and ignores what it does
 * not believe:
 * - `hello` only once, and only before any command has started (so before a
 *   command could print one);
 * - `finished` only with that nonce, and only while a command is running.
 */
export class BlockTracker<M extends LineMarker> {
  private nonce: string | undefined;
  private sawCommand = false;
  private prompt: M | undefined;
  private current: RunningCommand<M> | undefined;

  get running(): RunningCommand<M> | undefined {
    return this.current;
  }

  /** The shell drew a prompt: the next command's block starts on its line. */
  promptStarted(marker: M): void {
    this.prompt = marker;
  }

  /** A command started (Theia's `command_started`). */
  commandStarted(nowMs: number): RunningCommand<M> {
    this.sawCommand = true;
    this.current = { prompt: this.prompt, startMs: nowMs };
    return this.current;
  }

  /**
   * A spexr payload. `endLine` is the cursor's absolute line and `cursorX` its
   * column: output that did not end in a newline leaves the cursor on its last line.
   */
  mark(payload: string, endLine: number, cursorX: number): { readonly kind: "hello" } | { readonly kind: "finished"; readonly block: FinishedBlock<M> } | undefined {
    const mark = parseSpexrMark(payload);
    if (!mark) return undefined;
    if (mark.kind === "hello") {
      if (this.nonce !== undefined || this.sawCommand) return undefined;
      this.nonce = mark.nonce;
      return { kind: "hello" };
    }
    const run = this.current;
    if (this.nonce === undefined || mark.nonce !== this.nonce || !run) return undefined;
    this.current = undefined;
    const startLine = run.prompt?.line ?? -1;
    const lines = startLine >= 0 ? Math.max(1, endLine - startLine + (cursorX > 0 ? 1 : 0)) : 0;
    const raw = mark.epochMs - run.startMs;
    const durationMs = raw >= -1000 && raw <= MAX_DURATION_MS ? Math.max(0, raw) : undefined;
    return { kind: "finished", block: { prompt: run.prompt, lines, startMs: run.startMs, endMs: mark.epochMs, durationMs, exit: mark.exit } };
  }
}

/** The kit's `data-exit` for an exit code: `0` success, `cancelled` for a stop the user asked for (130, 143), the code otherwise. */
export function exitAttr(exit: number): string {
  if (exit === 0) return "0";
  if (exit === 130 || exit === 143) return "cancelled";
  return String(exit);
}

export interface BlockMeta {
  /** Empty while the command runs. */
  readonly time: string;
  readonly duration: string;
  readonly exit: string;
  /** Absent while the command runs: no mark. */
  readonly exitAttr: string | undefined;
}

/** What the block's chip says for a finished command: the time it started, how long it took, how it ended. */
export function finishedMeta(b: Pick<FinishedBlock<LineMarker>, "startMs" | "durationMs" | "exit">): BlockMeta {
  return { time: formatClock(b.startMs), duration: b.durationMs === undefined ? "" : formatDuration(b.durationMs), exit: `exit ${b.exit}`, exitAttr: exitAttr(b.exit) };
}

/** What it says while the command still runs. */
export const RUNNING_META: BlockMeta = { time: "", duration: "", exit: "running", exitAttr: undefined };

/** The slice of the DOM the chip is built with, so it is built (and tested) without a document. */
export interface DomElement {
  className: string;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: DomElement): unknown;
}
export interface DomDocument {
  createElement(tag: string): DomElement;
}

/**
 * The block's element: the chip with the time, the duration and the exit, built
 * element by element with `textContent`, never from markup. The frame and the
 * seam are CSS on the element (spexr.css, TERMINAL_BLOCK).
 */
export function buildBlockElement(doc: DomDocument, meta: BlockMeta, framed: boolean): DomElement {
  const root = doc.createElement("div");
  root.className = "spexr-term-block";
  root.setAttribute("data-frame", framed ? "true" : "false");
  if (meta.exitAttr !== undefined) root.setAttribute("data-exit", meta.exitAttr);
  const chip = doc.createElement("span");
  chip.className = "spexr-term-block__meta";
  const parts: Array<[string, string, string]> = [
    ["time", meta.time, "spexr-term-block__time"],
    ["span", meta.duration, "spexr-term-block__duration"],
    ["span", meta.exit, "spexr-term-block__exit"],
  ];
  for (const [tag, text, cls] of parts) {
    if (!text) continue;
    const el = doc.createElement(tag);
    el.className = cls;
    el.textContent = text;
    chip.appendChild(el);
  }
  root.appendChild(chip);
  return root;
}
