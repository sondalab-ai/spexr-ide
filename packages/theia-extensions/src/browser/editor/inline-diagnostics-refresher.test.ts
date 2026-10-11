import { describe, expect, it } from "vitest";
import { MAX_WAIT_MS, REFRESH_MS, InlineDiagnosticsRefresher, type InlineEditorPort, type Timers } from "./inline-diagnostics-refresher.js";
import type { InlineDiagnostic } from "./inline-diagnostics.js";

/** Fake timers: time moves only when told, and what is due runs in order. */
class Clock implements Timers {
  t = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.t + ms, fn });
    return id;
  }
  clear(h: unknown): void {
    this.pending.delete(h as number);
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = end;
  }
  get waiting(): number {
    return this.pending.size;
  }
}

interface FakeEditor extends InlineEditorPort {
  applied: Array<readonly InlineDiagnostic[]>;
  cleared: number;
  messages: string[];
  fail: boolean;
  visible: boolean;
}

function editor(key: string, uri: string, messages: string[] = ["a warning"]): FakeEditor {
  const e: FakeEditor = {
    key,
    uri,
    visible: true,
    applied: [],
    cleared: 0,
    messages,
    fail: false,
    markers: () => {
      if (e.fail) throw new Error("getLineMaxColumn: bad line");
      return e.messages.map((m, i) => ({ line: i + 1, severity: 2, message: m }));
    },
    layout: () => ({ columns: 120, lineCount: 50, lineLength: () => 10 }),
    apply: (shown) => void e.applied.push(shown),
    clear: () => void e.cleared++,
  };
  return e;
}

function setup(editors: FakeEditor[], enabled = { on: true }): { r: InlineDiagnosticsRefresher; clock: Clock; warnings: string[]; enabled: { on: boolean } } {
  const clock = new Clock();
  const warnings: string[] = [];
  const r = new InlineDiagnosticsRefresher({ editors: () => editors, enabled: () => enabled.on, warn: (m) => void warnings.push(m) }, clock);
  return { r, clock, warnings, enabled };
}

describe("InlineDiagnosticsRefresher", () => {
  it("waits for a pause: a burst of changes is one refresh, REFRESH_MS after the last", () => {
    const e = editor("a", "file:///a");
    const { r, clock } = setup([e]);
    r.schedule();
    clock.advance(100);
    r.schedule();
    clock.advance(100);
    r.schedule();
    clock.advance(REFRESH_MS - 1);
    expect(e.applied).toHaveLength(0);
    clock.advance(1);
    expect(e.applied).toHaveLength(1);
  });

  it("never waits longer than MAX_WAIT_MS from the first change of a burst, however it keeps coming, and goes on refreshing through a long burst", () => {
    const e = editor("a", "file:///a");
    const { r, clock } = setup([e]);
    const appliedAt: number[] = [];
    e.apply = () => void appliedAt.push(clock.t);
    // A burst that never pauses for REFRESH_MS: a change every 150ms for 6s, each one changing what would be drawn.
    for (let i = 0; i < 40; i++) {
      e.messages = [`warning ${i}`];
      r.schedule();
      clock.advance(150);
    }
    expect(appliedAt[0]).toBeLessThanOrEqual(MAX_WAIT_MS);
    expect(appliedAt.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < appliedAt.length; i++) expect(appliedAt[i]! - appliedAt[i - 1]!).toBeLessThanOrEqual(MAX_WAIT_MS + 150);
  });

  it("decorates only the editors showing, and skips a marker change for a file no editor shows", () => {
    const shown = editor("a", "file:///a");
    const hidden = editor("b", "file:///b");
    hidden.visible = false;
    const { r, clock } = setup([shown, hidden]);
    r.markersChanged("file:///b");
    r.markersChanged("file:///elsewhere");
    expect(clock.waiting).toBe(0);
    r.markersChanged("file:///a");
    clock.advance(REFRESH_MS);
    expect(shown.applied).toHaveLength(1);
    expect(hidden.applied).toHaveLength(0);
  });

  it("does not touch an editor whose chips would be the same, and draws again when they change", () => {
    const e = editor("a", "file:///a");
    const { r } = setup([e]);
    r.refresh();
    r.refresh();
    expect(e.applied).toHaveLength(1);
    e.messages = ["a warning", "another"];
    r.refresh();
    expect(e.applied).toHaveLength(2);
  });

  it("draws again when only the part of a message past the chip's cut changed: the hover has the whole of it", () => {
    const e = editor("a", "file:///a", ["Promise returned from cache.write is not awaited here, at all: first version"]);
    e.layout = () => ({ columns: 40, lineCount: 50, lineLength: () => 5 });
    const { r } = setup([e]);
    r.refresh();
    expect(e.applied).toHaveLength(1);
    // The chip's text is the same (cut well before the change); the hover's is not.
    e.messages = ["Promise returned from cache.write is not awaited here, at all: second version"];
    r.refresh();
    expect(e.applied).toHaveLength(2);
    expect(e.applied[1]![0]!.text).toBe(e.applied[0]![0]!.text);
    expect(e.applied[1]![0]!.full).toContain("second version");
  });

  it("clears the editors when the preference goes off, and draws them again when it comes back (fake timers)", () => {
    const e = editor("a", "file:///a");
    const en = { on: true };
    const { r, clock } = setup([e], en);
    r.refresh();
    expect(e.applied).toHaveLength(1);
    en.on = false;
    r.schedule();
    clock.advance(REFRESH_MS);
    expect(e.cleared).toBe(1);
    en.on = true;
    r.schedule();
    clock.advance(REFRESH_MS);
    expect(e.applied).toHaveLength(2);
  });

  it("does not clear an editor it never drew, and does not draw a hidden one when the preference comes back", () => {
    const e = editor("a", "file:///a");
    e.visible = false;
    const en = { on: false };
    const { r } = setup([e], en);
    r.refresh();
    expect(e.cleared).toBe(0);
    en.on = true;
    r.refresh();
    expect(e.applied).toHaveLength(0);
  });

  it("carries on with the other editors when one throws, and says so", () => {
    const bad = editor("a", "file:///a");
    bad.fail = true;
    const good = editor("b", "file:///b");
    const { r, warnings } = setup([bad, good]);
    r.refresh();
    expect(good.applied).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("file:///a");
  });

  it("forgets a closed editor, so a new one with the same key is drawn", () => {
    const first = editor("a", "file:///a");
    const list = [first];
    const clock = new Clock();
    const r = new InlineDiagnosticsRefresher({ editors: () => list, enabled: () => true, warn: () => undefined }, clock);
    r.refresh();
    list.length = 0;
    r.refresh();
    const again = editor("a", "file:///a");
    list.push(again);
    r.refresh();
    expect(again.applied).toHaveLength(1);
  });

  it("stops its timer on dispose", () => {
    const e = editor("a", "file:///a");
    const { r, clock } = setup([e]);
    r.schedule();
    r.dispose();
    clock.advance(REFRESH_MS * 2);
    expect(e.applied).toHaveLength(0);
  });
});
