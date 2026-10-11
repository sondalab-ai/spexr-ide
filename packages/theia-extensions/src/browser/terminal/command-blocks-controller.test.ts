import { describe, expect, it } from "vitest";
import { MAX_BLOCKS, TerminalBlocks, type BlockHost, type XtermDecoration, type XtermLike, type XtermMarker } from "./command-blocks-controller.js";

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

function setup(): { term: FakeTerm; blocks: TerminalBlocks; clock: { t: number } } {
  fake = new FakeTerm();
  const clock = { t: T0 };
  const blocks = new TerminalBlocks(fake, () => clock.t);
  return { term: fake, blocks, clock };
}

/** One command the way the shell scripts and Theia's mark it. */
function command(term: FakeTerm, clock: { t: number }, exit: number, outputLines: number, ms = 2400): void {
  term.osc("prompt_started");
  term.line += 1; // the command is typed on the prompt's line, and Enter moves down
  term.osc("command_started;41");
  clock.t += ms;
  term.line += outputLines;
  term.osc(`spexr_finished;${N};${exit};${clock.t}`);
  term.osc("command_finished");
  term.line += 1;
}

describe("TerminalBlocks", () => {
  it("draws a block over the command's lines when it finishes: from the prompt to the end of the output", () => {
    const { term, clock } = setup();
    term.osc(`spexr_hello;${N}`);
    term.osc("prompt_started");
    expect(term.markers[0]!.line).toBe(0);
    term.line = 1;
    term.osc("command_started;41");
    clock.t += 2400;
    term.line = 4; // three lines of output
    expect(term.osc(`spexr_finished;${N};0;${clock.t}`)).toBe(true);
    const framed = term.decos.filter((d) => d.options.height! > 1);
    expect(framed).toHaveLength(1);
    expect(framed[0]!.options).toMatchObject({ x: 0, width: 80, height: 4, layer: "top" });
    expect(framed[0]!.options.marker).toBe(term.markers[0]);
  });

  it("draws a running command as the chip alone on its prompt line, and takes it away when the command finishes", () => {
    const { term, clock } = setup();
    term.osc(`spexr_hello;${N}`);
    term.osc("prompt_started");
    term.line = 1;
    term.osc("command_started;41");
    expect(term.decos).toHaveLength(1);
    expect(term.decos[0]!.options.height).toBe(1);
    clock.t += 5;
    term.line = 2;
    term.osc(`spexr_finished;${N};0;${clock.t}`);
    expect(term.decos[0]!.isDisposed).toBe(true);
    expect(term.decos).toHaveLength(2);
  });

  it("fills each element once, with the time, the duration and the exit as text, however often xterm renders it", () => {
    const { term, clock } = setup();
    term.osc(`spexr_hello;${N}`);
    command(term, clock, 1, 2, 800);
    const final = term.decos[term.decos.length - 1]!;
    const h = host();
    final.render(h);
    final.render(h);
    expect(h.appended).toBe(1);
  });

  it("lets Theia's own marks through (false) and takes spexr's (true), believed or not", () => {
    const { term } = setup();
    // Only this handler is registered here: what it answers is what Theia's, behind it, would or would not see.
    expect(term.osc("prompt_started")).toBe(false);
    expect(term.osc("command_started;41")).toBe(false);
    expect(term.osc("command_finished")).toBe(false);
    expect(term.osc("spexr_garbage")).toBe(true);
  });

  it("is not fooled by text a command prints: a finished mark with the wrong nonce, or before the hello, draws no block", () => {
    const { term, clock } = setup();
    term.osc("prompt_started");
    term.line = 1;
    term.osc("command_started;41");
    term.line = 3;
    // Printed by `cat evil.txt`: no hello was ever told, so nothing is believed.
    term.osc(`spexr_finished;${N};0;${clock.t}`);
    expect(term.decos.filter((d) => d.options.height! > 1)).toHaveLength(0);
    // Even a forged hello now cannot start believing: a command has already run.
    term.osc(`spexr_hello;${"f".repeat(32)}`);
    term.osc(`spexr_finished;${"f".repeat(32)};0;${clock.t}`);
    expect(term.decos.filter((d) => d.options.height! > 1)).toHaveLength(0);
  });

  it("keeps the chip alone when the terminal is resized to another width: the frames' heights are no longer true", () => {
    const { term, clock } = setup();
    term.osc(`spexr_hello;${N}`);
    command(term, clock, 0, 3);
    command(term, clock, 1, 2);
    const framedBefore = term.decos.filter((d) => d.options.height! > 1 && !d.isDisposed);
    expect(framedBefore).toHaveLength(2);
    term.cols = 120;
    for (const l of term.resizeListeners) l({ cols: 120, rows: 24 });
    expect(framedBefore.every((d) => d.isDisposed)).toBe(true);
    const chips = term.decos.filter((d) => !d.isDisposed && d.options.height === 1 && d.options.width === 120);
    expect(chips).toHaveLength(2);
    // A resize that keeps the width changes nothing.
    const count = term.decos.length;
    for (const l of term.resizeListeners) l({ cols: 120, rows: 40 });
    expect(term.decos).toHaveLength(count);
  });

  it("draws nothing for a command whose prompt scrolled out of the buffer", () => {
    const { term, clock } = setup();
    term.osc(`spexr_hello;${N}`);
    term.osc("prompt_started");
    term.line = 1;
    term.osc("command_started;41");
    term.markers[0]!.line = -1;
    term.markers[0]!.dispose();
    clock.t += 5;
    term.line = 2;
    term.osc(`spexr_finished;${N};0;${clock.t}`);
    expect(term.decos.filter((d) => d.options.height! > 1)).toHaveLength(0);
  });

  it("keeps the last MAX_BLOCKS blocks and lets the oldest go", () => {
    const { term, clock, blocks } = setup();
    term.osc(`spexr_hello;${N}`);
    for (let i = 0; i < MAX_BLOCKS + 3; i++) command(term, clock, 0, 1);
    expect(blocks.count).toBe(MAX_BLOCKS);
    expect(term.decos.filter((d) => d.options.height! > 1 && d.isDisposed)).toHaveLength(3);
  });

  it("registers its handler again, in front, when asked: Theia re-registers its own on a preference change", () => {
    const { term, blocks } = setup();
    const theia = (): boolean => true;
    term.oscHandlers.push(theia);
    // Theia's handler is now last, so it would be asked first and take every mark.
    expect(term.osc(`spexr_hello;${N}`)).toBe(true);
    blocks.hook();
    expect(term.oscHandlers[term.oscHandlers.length - 1]).not.toBe(theia);
  });

  it("lets go of its handler, its resize listener and its decorations on dispose", () => {
    const { term, clock, blocks } = setup();
    term.osc(`spexr_hello;${N}`);
    command(term, clock, 0, 1);
    blocks.dispose();
    expect(term.oscHandlers).toHaveLength(0);
    expect(term.resizeListeners).toHaveLength(0);
    expect(term.decos.every((d) => d.isDisposed)).toBe(true);
  });
});
