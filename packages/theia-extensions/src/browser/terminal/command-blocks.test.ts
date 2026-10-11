import { describe, expect, it } from "vitest";
import { BlockTracker, RUNNING_META, buildBlockElement, exitAttr, finishedMeta, isNonce, isSpexrPayload, parseSpexrMark, type DomDocument, type DomElement } from "./command-blocks.js";

const N = "0123456789abcdef0123456789abcdef";
const prompt = `spexr_prompt;${N}`;
const started = (ms: number | string = 1_791_739_000_000, nonce = N): string => `spexr_started;${nonce};${ms}`;
const finished = (exit: number | string, ms: number | string, nonce = N): string => `spexr_finished;${nonce};${exit};${ms}`;
const mk = (line: number): { line: number } => ({ line });

describe("parseSpexrMark", () => {
  it("reads the three exact shapes", () => {
    expect(parseSpexrMark(prompt)).toEqual({ kind: "prompt", nonce: N });
    expect(parseSpexrMark(started(1_791_739_004_123))).toEqual({ kind: "started", nonce: N, epochMs: 1_791_739_004_123 });
    expect(parseSpexrMark(finished(0, 1_791_739_004_123))).toEqual({ kind: "finished", nonce: N, exit: 0, epochMs: 1_791_739_004_123 });
    expect(parseSpexrMark(finished(255, 1_791_739_004_123))).toMatchObject({ exit: 255 });
    expect(parseSpexrMark(finished(130, 1_791_739_004_123))).toMatchObject({ exit: 130 });
  });

  it("refuses everything else: extra text, a short or upper-case nonce, an exit past 255 or with a leading zero, a signed or fractional number, an old epoch, the old hello", () => {
    for (const bad of [
      `${prompt};x`,
      `${prompt} `,
      `spexr_prompt;${N.slice(1)}`,
      `spexr_prompt;${N.toUpperCase()}`,
      `spexr_hello;${N}`,
      started("1791739"),
      started("1791739004123.5"),
      finished(256, 1_791_739_004_123),
      finished("00", 1_791_739_004_123),
      finished("01", 1_791_739_004_123),
      finished(-1, 1_791_739_004_123),
      finished("1.5", 1_791_739_004_123),
      finished(0, 1_791_739),
      finished(0, "1791739004123.5"),
      finished(0, 1_791_739_004_123) + ";extra",
      `spexr_finished;${N};0`,
      "spexr_finished",
      "spexr_other;1",
      "command_finished",
      "command_started;41",
      "prompt_started",
      "",
    ]) {
      expect(parseSpexrMark(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("refuses a payload that is far too long, however it starts", () => {
    expect(parseSpexrMark(finished(0, 1_791_739_004_123) + "0".repeat(200))).toBeUndefined();
  });

  it("knows a payload in spexr's namespace, believed or not, and the shape of a nonce", () => {
    expect(isSpexrPayload("spexr_finished;junk")).toBe(true);
    expect(isSpexrPayload("command_started;41")).toBe(false);
    expect(isNonce(N)).toBe(true);
    expect(isNonce(N + "0")).toBe(false);
    expect(isNonce("")).toBe(false);
  });
});

describe("BlockTracker", () => {
  const T0 = 1_791_739_000_000;
  const tracker = (nonce: string | null = N): BlockTracker<{ line: number }> => {
    const t = new BlockTracker<{ line: number }>();
    t.setNonce(nonce ?? undefined);
    return t;
  };
  const fin = (t: BlockTracker<{ line: number }>, payload: string, endLine: number, cursorX = 0) => {
    const m = t.accept(payload);
    return m?.kind === "finished" ? t.finish(m, endLine, cursorX) : undefined;
  };

  it("closes a block when a finished mark with the nonce arrives for a running command: lines from the prompt, a duration from the shell's own clock, the exit", () => {
    const t = tracker();
    t.promptStarted(mk(10));
    t.commandStarted(T0);
    const block = fin(t, finished(1, T0 + 2400), 14);
    expect(block).toMatchObject({ lines: 4, durationMs: 2400, exit: 1, startMs: T0, endMs: T0 + 2400 });
    expect(t.running).toBeUndefined();
  });

  it("counts the cursor's own line when the output did not end in a newline", () => {
    const t = tracker();
    t.promptStarted(mk(10));
    t.commandStarted(T0);
    expect(fin(t, finished(0, T0 + 10), 12, 5)?.lines).toBe(3);
  });

  it("believes nothing until it has the nonce, and nothing after a malformed one", () => {
    expect(tracker(null).accept(prompt)).toBeUndefined();
    expect(tracker("short").accept(prompt)).toBeUndefined();
    const t = tracker(null);
    expect(t.accept(started(T0))).toBeUndefined();
    t.setNonce(N);
    expect(t.accept(started(T0))).toMatchObject({ kind: "started" });
  });

  it("never forges a block: a mark with another nonce is refused, a forged hello cannot set the nonce, and a finished mark with no command running closes nothing", () => {
    const t = tracker();
    const other = "f".repeat(32);
    expect(t.accept(prompt.replace(N, other))).toBeUndefined();
    expect(t.accept(started(T0, other))).toBeUndefined();
    expect(t.accept(finished(0, T0 + 5, other))).toBeUndefined();
    // The old in-band hello is no mark at all: it cannot give a terminal a nonce.
    expect(t.accept(`spexr_hello;${other}`)).toBeUndefined();
    t.promptStarted(mk(1));
    expect(fin(t, finished(0, T0 + 5), 3)).toBeUndefined();
  });

  it("ignores Theia's own marks: they are not spexr's, so a forged prompt_started or command_started moves no block and resets no time", () => {
    const t = tracker();
    for (const forged of ["prompt_started", "command_started;41", "command_started", "command_finished"]) expect(t.accept(forged)).toBeUndefined();
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    expect(t.accept("command_started;41")).toBeUndefined();
    expect(t.running?.startMs).toBe(T0);
  });

  it("closes one block for a mark seen twice", () => {
    const t = tracker();
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    expect(fin(t, finished(0, T0 + 5), 3)).toBeDefined();
    expect(fin(t, finished(0, T0 + 5), 3)).toBeUndefined();
  });

  it("has no duration when the end is more than a day after the start, and none for an end before it by more than the clock's second", () => {
    const t = tracker();
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    expect(fin(t, finished(0, T0 + 3 * 24 * 3_600_000), 3)?.durationMs).toBeUndefined();
    t.promptStarted(mk(4));
    t.commandStarted(T0);
    expect(fin(t, finished(0, T0 - 200), 6)?.durationMs).toBe(0);
    t.promptStarted(mk(7));
    t.commandStarted(T0);
    expect(fin(t, finished(0, T0 - 5000), 9)?.durationMs).toBeUndefined();
  });

  it("has no lines for a block whose prompt marker is gone (scrolled out of the buffer)", () => {
    const t = tracker();
    t.promptStarted(mk(-1));
    t.commandStarted(T0);
    expect(fin(t, finished(0, T0 + 1), 3)?.lines).toBe(0);
  });
});

describe("exit and meta", () => {
  it("maps the exit to the kit's data-exit: 0, cancelled for 130 and 143, the code otherwise", () => {
    expect([0, 130, 143, 1, 2, 127].map(exitAttr)).toEqual(["0", "cancelled", "cancelled", "1", "2", "127"]);
  });

  it("says the start time, the duration and the exit of a finished command, and 'running' while it runs", () => {
    const at = new Date(2026, 9, 9, 14, 2, 11).getTime();
    expect(finishedMeta({ startMs: at, durationMs: 2400, exit: 0 })).toEqual({ time: "14:02:11", duration: "2.4 s", exit: "exit 0", exitAttr: "0" });
    expect(finishedMeta({ startMs: at, durationMs: undefined, exit: 1 })).toEqual({ time: "14:02:11", duration: "", exit: "exit 1", exitAttr: "1" });
    expect(RUNNING_META).toEqual({ time: "", duration: "", exit: "running", exitAttr: undefined });
  });
});

/** A document that records what was built: elements with a tag, class, attributes, text and children. */
class FakeEl implements DomElement {
  className = "";
  textContent: string | null = null;
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  constructor(readonly tag: string) {}
  setAttribute(n: string, v: string): void {
    this.attrs[n] = v;
  }
  appendChild(c: DomElement): void {
    this.children.push(c as FakeEl);
  }
}
const doc: DomDocument = { createElement: (tag) => new FakeEl(tag) };

describe("buildBlockElement", () => {
  it("builds the chip from elements and text: time, duration, exit, each with its class", () => {
    const root = buildBlockElement(doc, { time: "14:02:11", duration: "2.4 s", exit: "exit 0", exitAttr: "0" }, true) as FakeEl;
    expect(root.className).toBe("spexr-term-block");
    expect(root.attrs).toEqual({ "data-frame": "true", "data-exit": "0" });
    const chip = root.children[0]!;
    expect(chip.className).toBe("spexr-term-block__meta");
    expect(chip.children.map((c) => [c.tag, c.className, c.textContent])).toEqual([
      ["time", "spexr-term-block__time", "14:02:11"],
      ["span", "spexr-term-block__duration", "2.4 s"],
      ["span", "spexr-term-block__exit", "exit 0"],
    ]);
  });

  it("leaves out the pieces it has nothing for, and the mark while the command runs", () => {
    const root = buildBlockElement(doc, { time: "", duration: "", exit: "running", exitAttr: undefined }, false) as FakeEl;
    expect(root.attrs).toEqual({ "data-frame": "false" });
    expect(root.children[0]!.children.map((c) => c.textContent)).toEqual(["running"]);
  });

  it("only ever sets text: what the meta says is never markup, so nothing in it can be an element", () => {
    const hostile = '<img src=x onerror=alert(1)>"\'&';
    const root = buildBlockElement(doc, { time: hostile, duration: hostile, exit: hostile, exitAttr: hostile }, true) as FakeEl;
    for (const c of root.children[0]!.children) {
      expect(c.textContent).toBe(hostile);
      expect(c.children).toHaveLength(0);
    }
    expect(JSON.stringify(Object.keys(FakeEl.prototype))).not.toMatch(/innerHTML/);
  });
});
