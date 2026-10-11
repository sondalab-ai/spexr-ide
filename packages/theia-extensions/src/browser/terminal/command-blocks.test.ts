import { describe, expect, it } from "vitest";
import { BlockTracker, RUNNING_META, buildBlockElement, exitAttr, finishedMeta, isSpexrPayload, parseSpexrMark, type DomDocument, type DomElement } from "./command-blocks.js";

const N = "0123456789abcdef0123456789abcdef";
const hello = `spexr_hello;${N}`;
const finished = (exit: number | string, ms: number | string, nonce = N): string => `spexr_finished;${nonce};${exit};${ms}`;
const mk = (line: number): { line: number } => ({ line });

describe("parseSpexrMark", () => {
  it("reads the two exact shapes", () => {
    expect(parseSpexrMark(hello)).toEqual({ kind: "hello", nonce: N });
    expect(parseSpexrMark(finished(0, 1_791_739_004_123))).toEqual({ kind: "finished", nonce: N, exit: 0, epochMs: 1_791_739_004_123 });
    expect(parseSpexrMark(finished(255, 1_791_739_004_123))).toMatchObject({ exit: 255 });
  });

  it("refuses everything else: extra text, a short or upper-case nonce, an exit past 255, a signed or fractional number, an old epoch", () => {
    for (const bad of [
      `${hello};x`,
      `${hello} `,
      `spexr_hello;${N.slice(1)}`,
      `spexr_hello;${N.toUpperCase()}`,
      finished(256, 1_791_739_004_123),
      finished(-1, 1_791_739_004_123),
      finished("1.5", 1_791_739_004_123),
      finished(0, 1_791_739),
      finished(0, "1791739004123.5"),
      finished(0, 1_791_739_004_123) + ";extra",
      `spexr_finished;${N};0`,
      "spexr_finished",
      "spexr_other;1",
      "command_finished",
      "",
    ]) {
      expect(parseSpexrMark(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("refuses a payload that is far too long, however it starts", () => {
    expect(parseSpexrMark(finished(0, 1_791_739_004_123) + "0".repeat(200))).toBeUndefined();
  });

  it("knows a payload in spexr's namespace, believed or not", () => {
    expect(isSpexrPayload("spexr_finished;junk")).toBe(true);
    expect(isSpexrPayload("command_started;41")).toBe(false);
  });
});

describe("BlockTracker", () => {
  const T0 = 1_791_739_000_000;

  it("closes a block when a finished mark with the nonce arrives for a running command: lines from the prompt, a duration, the exit", () => {
    const t = new BlockTracker<{ line: number }>();
    expect(t.mark(hello, 0, 0)).toEqual({ kind: "hello" });
    t.promptStarted(mk(10));
    t.commandStarted(T0);
    const done = t.mark(finished(1, T0 + 2400), 14, 0);
    expect(done?.kind).toBe("finished");
    if (done?.kind !== "finished") return;
    expect(done.block).toMatchObject({ lines: 4, durationMs: 2400, exit: 1, startMs: T0, endMs: T0 + 2400 });
    expect(t.running).toBeUndefined();
  });

  it("counts the cursor's own line when the output did not end in a newline", () => {
    const t = new BlockTracker<{ line: number }>();
    t.mark(hello, 0, 0);
    t.promptStarted(mk(10));
    t.commandStarted(T0);
    const done = t.mark(finished(0, T0 + 10), 12, 5);
    expect(done?.kind === "finished" && done.block.lines).toBe(3);
  });

  it("never forges a block: a finished mark with another nonce, before hello, or with no command running is ignored", () => {
    const t = new BlockTracker<{ line: number }>();
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    // No hello yet: nothing is believed.
    expect(t.mark(finished(0, T0 + 5), 3, 0)).toBeUndefined();
    t.mark(hello, 0, 0); // too late: a command has started, so a hello now is a forgery
    expect(t.mark(finished(0, T0 + 5), 3, 0)).toBeUndefined();
  });

  it("takes the nonce told before any command, once; a later hello (printed by a command) changes nothing", () => {
    const t = new BlockTracker<{ line: number }>();
    expect(t.mark(hello, 0, 0)).toEqual({ kind: "hello" });
    expect(t.mark(`spexr_hello;${"f".repeat(32)}`, 0, 0)).toBeUndefined();
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    expect(t.mark(finished(0, T0 + 5, "f".repeat(32)), 3, 0)).toBeUndefined();
    expect(t.mark(finished(0, T0 + 5), 3, 0)?.kind).toBe("finished");
  });

  it("ignores a finished mark while nothing runs: the same mark twice closes one block", () => {
    const t = new BlockTracker<{ line: number }>();
    t.mark(hello, 0, 0);
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    expect(t.mark(finished(0, T0 + 5), 3, 0)?.kind).toBe("finished");
    expect(t.mark(finished(0, T0 + 5), 3, 0)).toBeUndefined();
  });

  it("has no duration when the shell's clock and the terminal's disagree by more than a day, and none before the start", () => {
    const t = new BlockTracker<{ line: number }>();
    t.mark(hello, 0, 0);
    t.promptStarted(mk(1));
    t.commandStarted(T0);
    const skewed = t.mark(finished(0, T0 + 3 * 24 * 3_600_000), 3, 0);
    expect(skewed?.kind === "finished" && skewed.block.durationMs).toBeUndefined();
    t.promptStarted(mk(4));
    t.commandStarted(T0);
    const slightly = t.mark(finished(0, T0 - 200), 6, 0);
    expect(slightly?.kind === "finished" && slightly.block.durationMs).toBe(0);
  });

  it("has no lines for a block whose prompt marker is gone (scrolled out of the buffer)", () => {
    const t = new BlockTracker<{ line: number }>();
    t.mark(hello, 0, 0);
    t.promptStarted(mk(-1));
    t.commandStarted(T0);
    const done = t.mark(finished(0, T0 + 1), 3, 0);
    expect(done?.kind === "finished" && done.block.lines).toBe(0);
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
