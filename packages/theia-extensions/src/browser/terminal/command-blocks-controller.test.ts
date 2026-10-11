import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, MAX_PENDING, RELAY_MS, TerminalBlocks, type BlockHost, type XtermDecoration, type XtermLike, type XtermMarker } from "./command-blocks-controller.js";

const N = "0123456789abcdef0123456789abcdef";
const T0 = 1_791_739_000_000;

class FakeMarker implements XtermMarker {
  isDisposed = false;
  constructor(public line: number) {}
  dispose(): void {
    this.isDisposed = true;
  }
}

class FakeDeco implements XtermDecoration {
  isDisposed = false;
  private listeners: Array<(h: BlockHost) => void> = [];
  constructor(readonly options: { marker: XtermMarker; x?: number; width?: number; height?: number; layer?: string }) {}
  dispose(): void {
    this.isDisposed = true;
  }
  onRender(l: (h: BlockHost) => void): { dispose(): void } {
    this.listeners.push(l);
    return { dispose: () => void 0 };
  }
  /** What xterm does: make the element and tell the listeners, as often as it renders. */
  render(host: BlockHost): void {
    for (const l of this.listeners) l(host);
  }
}

function host(): BlockHost & { appended: number } {
  const make = (): { className: string; textContent: string | null; setAttribute(): void; appendChild(): void } => ({ className: "", textContent: null, setAttribute: () => undefined, appendChild: () => undefined });
  const h = { ...make(), appended: 0, ownerDocument: { createElement: make } };
  h.appendChild = () => void h.appended++;
  return h as unknown as BlockHost & { appended: number };
}

class FakeTerm implements XtermLike {
  cols = 80;
  line = 0;
  cursorX = 0;
  buffer = { active: { get baseY() { return 0; }, get cursorY() { return fake.line; }, get cursorX() { return fake.cursorX; } } };
  oscHandlers: Array<(d: string) => boolean | Promise<boolean>> = [];
  resizeListeners: Array<(s: { cols: number; rows: number }) => void> = [];
  markers: FakeMarker[] = [];
  decos: FakeDeco[] = [];
  parser = { registerOscHandler: (_id: number, h: (d: string) => boolean | Promise<boolean>) => (this.oscHandlers.push(h), { dispose: () => void this.oscHandlers.splice(this.oscHandlers.indexOf(h), 1) }) };
  registerMarker(): XtermMarker {
    const m = new FakeMarker(this.line);
    this.markers.push(m);
    return m;
  }
  registerDecoration(o: { marker: XtermMarker; x?: number; width?: number; height?: number; layer?: string }): XtermDecoration {
    const d = new FakeDeco(o);
    this.decos.push(d);
    return d;
  }
  onResize(l: (s: { cols: number; rows: number }) => void): { dispose(): void } {
    this.resizeListeners.push(l);
    return { dispose: () => void this.resizeListeners.splice(this.resizeListeners.indexOf(l), 1) };
  }
  /** What the parser does with an OSC 133: the most recently registered handler first, on until one returns true. */
  osc(payload: string): boolean {
    for (const h of [...this.oscHandlers].reverse()) if (h(payload) === true) return true;
    return false;
  }
}
let fake: FakeTerm;

/** Fake timers: time moves only when told. */
class Clock {
  t = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  timers = {
    set: (fn: () => void, ms: number): unknown => {
      const id = this.next++;
      this.pending.set(id, { at: this.t + ms, fn });
      return id;
    },
    clear: (h: unknown): void => void this.pending.delete(h as number),
  };
  advance(ms: number): void {
    this.t += ms;
    for (const [id, p] of [...this.pending]) {
      if (p.at <= this.t) {
        this.pending.delete(id);
        p.fn();
      }
    }
  }
}

function setup(nonce: string | null = N): { term: FakeTerm; blocks: TerminalBlocks; clock: Clock; changes: { n: number } } {
  fake = new FakeTerm();
  const clock = new Clock();
  const changes = { n: 0 };
  const blocks = new TerminalBlocks(fake, () => void changes.n++, clock.timers);
  blocks.setNonce(nonce ?? undefined);
  return { term: fake, blocks, clock, changes };
}

const prompt = `spexr_prompt;${N}`;
const started = (ms = T0, nonce = N): string => `spexr_started;${nonce};${ms}`;
const finished = (exit: number, ms: number, nonce = N): string => `spexr_finished;${nonce};${exit};${ms}`;

/** One command the way the shell scripts mark it: a prompt, the command typed on its line, output, the end. */
function command(term: FakeTerm, at: { ms: number }, exit: number, outputLines: number, ms = 2400): void {
  term.osc(prompt);
  term.line += 1; // the command is typed on the prompt's line, and Enter moves down
  term.osc(started(at.ms));
  at.ms += ms;
  term.line += outputLines;
  term.osc(finished(exit, at.ms));
  term.line += 1;
}

describe("TerminalBlocks", () => {
  it("draws a block over the command's lines when it finishes: from the prompt to the end of the output", () => {
    const { term } = setup();
    term.osc(prompt);
    expect(term.markers[0]!.line).toBe(0);
    term.line = 1;
    term.osc(started());
    term.line = 4; // three lines of output
    expect(term.osc(finished(0, T0 + 2400))).toBe(true);
    const framed = term.decos.filter((d) => d.options.height! > 1);
    expect(framed).toHaveLength(1);
    expect(framed[0]!.options).toMatchObject({ x: 0, width: 80, height: 4, layer: "top" });
    expect(framed[0]!.options.marker).toBe(term.markers[0]);
  });

  it("draws a running command as the chip alone on its prompt line, and takes it away when the command finishes", () => {
    const { term } = setup();
    term.osc(prompt);
    term.line = 1;
    term.osc(started());
    expect(term.decos).toHaveLength(1);
    expect(term.decos[0]!.options.height).toBe(1);
    term.line = 2;
    term.osc(finished(0, T0 + 5));
    expect(term.decos[0]!.isDisposed).toBe(true);
    expect(term.decos).toHaveLength(2);
  });

  it("fills each element once, as text, however often xterm renders it", () => {
    const { term } = setup();
    const at = { ms: T0 };
    command(term, at, 1, 2, 800);
    const final = term.decos[term.decos.length - 1]!;
    const h = host();
    final.render(h);
    final.render(h);
    expect(h.appended).toBe(1);
  });

  it("lets Theia's own marks through (false) and takes spexr's (true), believed or not", () => {
    const { term } = setup();
    expect(term.osc("prompt_started")).toBe(false);
    expect(term.osc("command_started;41")).toBe(false);
    expect(term.osc("command_finished")).toBe(false);
    expect(term.osc("spexr_garbage")).toBe(true);
  });

  it("moves no block for Theia's own marks, which anything may print: a forged prompt_started and command_started draw nothing and reset nothing", () => {
    const { term, blocks } = setup();
    term.osc(prompt);
    term.line = 1;
    term.osc(started(T0));
    term.osc("prompt_started");
    term.osc("command_started;41");
    term.line = 5;
    term.osc("prompt_started");
    term.osc(finished(0, T0 + 3000));
    expect(blocks.stats).toMatchObject({ prompts: 1, started: 1, finished: 1, rejected: 0 });
    const framed = term.decos.filter((d) => d.options.height! > 1);
    // From the real prompt marker, not from a printed one, and timed from the real start.
    expect(framed).toHaveLength(1);
    expect(framed[0]!.options.marker).toBe(term.markers[0]);
  });

  it("holds the marks it meets before it has the nonce, draws nothing for them yet, and checks them when the nonce comes: the first command gets its block", () => {
    const { term, blocks } = setup(null);
    // The shell's first prompt, and a first command typed at once, before the backend has answered.
    command(term, { ms: T0 }, 0, 2);
    expect(term.decos).toHaveLength(0);
    expect(blocks.stats).toMatchObject({ prompts: 0, finished: 0, rejected: 0 });
    blocks.setNonce(N);
    expect(blocks.stats).toMatchObject({ prompts: 1, started: 1, finished: 1, rejected: 0, drawn: 1 });
    const framed = term.decos.filter((d) => d.options.height! > 1);
    expect(framed).toHaveLength(1);
    // From the prompt line where the prompt mark was met, not where the cursor is now.
    expect(framed[0]!.options.marker.line).toBe(0);
    expect(framed[0]!.options.height).toBe(3);
  });

  it("refuses a held forged mark when the nonce comes, and holds no more than MAX_PENDING", () => {
    const { term, blocks } = setup(null);
    term.osc(`spexr_prompt;${"f".repeat(32)}`);
    term.osc(started(T0, "f".repeat(32)));
    for (let i = 0; i < MAX_PENDING + 10; i++) term.osc(prompt);
    blocks.setNonce(N);
    expect(blocks.stats.rejected).toBe(2);
    expect(blocks.stats.prompts).toBe(MAX_PENDING - 2);
  });

  it("lets the held marks and their markers go when there turns out to be no nonce", () => {
    const { term, blocks } = setup(null);
    term.osc(prompt);
    term.osc(prompt);
    blocks.setNonce(undefined);
    expect(term.markers.every((m) => m.isDisposed)).toBe(true);
    expect(blocks.stats.prompts).toBe(0);
  });

  it("lets held markers go on dispose", () => {
    const { term, blocks } = setup(null);
    term.osc(prompt);
    blocks.dispose();
    expect(term.markers.every((m) => m.isDisposed)).toBe(true);
  });

  it("is not fooled by text a command prints: marks with another nonce draw no block, and a forged hello gives no nonce", () => {
    const { term, blocks } = setup();
    term.osc(prompt);
    term.line = 1;
    term.osc(started());
    term.line = 3;
    const other = "f".repeat(32);
    term.osc(`spexr_hello;${other}`);
    term.osc(finished(7, T0 + 5, other));
    term.osc(`spexr_prompt;${other}`);
    expect(term.decos.filter((d) => d.options.height! > 1)).toHaveLength(0);
    expect(blocks.stats.rejected).toBe(3);
    // The real end still closes the real command, with its own exit.
    term.osc(finished(0, T0 + 5));
    expect(term.decos.filter((d) => d.options.height! > 1)).toHaveLength(1);
  });

  it("reports each mark it handles, so the terminal's element can show the counts without a timer", () => {
    const { term, changes } = setup();
    command(term, { ms: T0 }, 0, 1);
    expect(changes.n).toBe(3);
  });

  it("lays each frame again once the width has held still, as high as its lines now are, from the markers that follow the reflow", () => {
    const { term, clock } = setup();
    const at = { ms: T0 };
    command(term, at, 0, 3); // prompt at line 0, ends at 4: 4 lines
    command(term, at, 1, 2); // 3 lines
    const before = term.decos.filter((d) => d.options.height! > 1 && !d.isDisposed);
    expect(before.map((d) => d.options.height)).toEqual([4, 3]);
    // Markers, in order: prompt 1, end 1, prompt 2, end 2.
    expect(term.markers).toHaveLength(4);
    term.markers[1]!.line += 2;
    term.markers[2]!.line += 2; // the second prompt moved by the first block's growth
    term.markers[3]!.line += 4;
    term.cols = 40;
    for (const l of term.resizeListeners) l({ cols: 40, rows: 24 });
    // Not yet: a drag is many resizes.
    expect(before.every((d) => d.isDisposed)).toBe(false);
    clock.advance(RELAY_MS);
    expect(before.every((d) => d.isDisposed)).toBe(true);
    const laid = term.decos.filter((d) => !d.isDisposed && d.options.width === 40);
    expect(laid).toHaveLength(2);
    expect(laid.every((d) => d.options.height! > 1)).toBe(true);
    // A resize that keeps the width changes nothing.
    const count = term.decos.length;
    for (const l of term.resizeListeners) l({ cols: 40, rows: 40 });
    clock.advance(RELAY_MS * 2);
    expect(term.decos).toHaveLength(count);
  });

  it("acts once on a drag of many resizes, and lays the running command's chip again at the new width", () => {
    const { term, clock } = setup();
    term.osc(prompt);
    term.line = 1;
    term.osc(started());
    const first = term.decos[0]!;
    for (const cols of [79, 70, 60, 50]) {
      term.cols = cols;
      for (const l of term.resizeListeners) l({ cols, rows: 24 });
      clock.advance(RELAY_MS / 4);
    }
    expect(first.isDisposed).toBe(false);
    clock.advance(RELAY_MS);
    expect(first.isDisposed).toBe(true);
    const chips = term.decos.filter((d) => !d.isDisposed);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.options).toMatchObject({ width: 50, height: 1 });
  });

  it("keeps the chip alone after a resize when the block's end marker is gone", () => {
    const { term, clock } = setup();
    command(term, { ms: T0 }, 0, 3);
    term.markers[1]!.isDisposed = true;
    term.cols = 120;
    for (const l of term.resizeListeners) l({ cols: 120, rows: 24 });
    clock.advance(RELAY_MS);
    const chips = term.decos.filter((d) => !d.isDisposed && d.options.width === 120);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.options.height).toBe(1);
  });

  it("draws nothing for a command whose prompt scrolled out of the buffer, and lets its marker go", () => {
    const { term } = setup();
    term.osc(prompt);
    term.line = 1;
    term.osc(started());
    term.markers[0]!.line = -1;
    term.line = 2;
    term.osc(finished(0, T0 + 5));
    expect(term.decos.filter((d) => d.options.height! > 1)).toHaveLength(0);
    expect(term.markers[0]!.isDisposed).toBe(true);
  });

  it("keeps the last MAX_BLOCKS blocks, and lets the oldest go with its decoration and both of its markers", () => {
    const { term, blocks } = setup();
    const at = { ms: T0 };
    for (let i = 0; i < MAX_BLOCKS + 3; i++) command(term, at, 0, 1);
    expect(blocks.count).toBe(MAX_BLOCKS);
    expect(term.decos.filter((d) => d.options.height! > 1 && d.isDisposed)).toHaveLength(3);
    // Markers: a prompt and an end per command; the first three commands' are all gone.
    expect(term.markers.slice(0, 6).every((m) => m.isDisposed)).toBe(true);
    expect(term.markers[6]!.isDisposed).toBe(false);
  });

  it("lets go of a command that never reported its end when the next one starts: its chip and its prompt marker", () => {
    const { term } = setup();
    term.osc(prompt);
    term.line = 1;
    term.osc(started());
    const lost = term.decos[0]!;
    const lostPrompt = term.markers[0]!;
    // The finished mark never came; the next prompt and command did.
    term.line = 4;
    term.osc(prompt);
    term.line = 5;
    term.osc(started(T0 + 9000));
    expect(lost.isDisposed).toBe(true);
    expect(lostPrompt.isDisposed).toBe(true);
  });

  it("registers its handler again, in front, when asked: Theia re-registers its own on a preference change", () => {
    const { term, blocks } = setup();
    const theia = (): boolean => true;
    term.oscHandlers.push(theia);
    // Theia's handler is now last, so it would be asked first and take every mark.
    expect(term.osc(prompt)).toBe(true);
    expect(blocks.stats.prompts).toBe(0);
    blocks.hook();
    expect(term.oscHandlers[term.oscHandlers.length - 1]).not.toBe(theia);
    term.osc(prompt);
    expect(blocks.stats.prompts).toBe(1);
  });

  it("lets go of its handler, its resize listener, its timer, its decorations and every marker on dispose, the running command's and the idle prompt's included", () => {
    const { term, blocks, clock } = setup();
    command(term, { ms: T0 }, 0, 1);
    term.osc(prompt); // an idle prompt marker
    term.osc(started(T0 + 5000)); // a command still running, with its own prompt marker
    term.cols = 100;
    for (const l of term.resizeListeners) l({ cols: 100, rows: 24 });
    blocks.dispose();
    clock.advance(RELAY_MS * 3);
    expect(term.oscHandlers).toHaveLength(0);
    expect(term.resizeListeners).toHaveLength(0);
    expect(term.decos.every((d) => d.isDisposed)).toBe(true);
    expect(term.markers.every((m) => m.isDisposed)).toBe(true);
    // The relay timer did not run after dispose.
    expect(term.decos.filter((d) => d.options.width === 100)).toHaveLength(0);
  });
});
