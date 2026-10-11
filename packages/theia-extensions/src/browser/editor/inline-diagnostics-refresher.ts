import { inlineDiagnostics, type InlineDiagnostic, type InlineLayout, type InlineMarker } from "./inline-diagnostics.js";

/** One open editor, as the refresher drives it: Monaco's side of it is the contribution's. */
export interface InlineEditorPort {
  /** Stable for the editor's life. */
  readonly key: string;
  /** The file's URI, to tell whose markers changed. */
  readonly uri: string;
  /** Showing now: a hidden editor is not decorated. */
  readonly visible: boolean;
  markers(): InlineMarker[];
  layout(): InlineLayout;
  apply(shown: readonly InlineDiagnostic[]): void;
  clear(): void;
}

export interface RefresherPorts {
  editors(): readonly InlineEditorPort[];
  enabled(): boolean;
  /** Where one editor's failure goes; the others are still done. */
  warn(message: string, error: unknown): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const REAL: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), now: () => Date.now() };

/** After the last change; and never later than {@link MAX_WAIT_MS} after the first of a burst, however it keeps coming. */
export const REFRESH_MS = 200;
export const MAX_WAIT_MS = 1000;

/** A key that changes when what would be drawn changes: the chip, and the whole message of the hover (a change past the cut still redraws). */
const keyOf = (shown: readonly InlineDiagnostic[]): string => shown.map((d) => `${d.line}:${d.tone}:${d.text}:${d.full}`).join("\n");

/**
 * Keeps the editors' inline diagnostics up to date without work the screen
 * would not show (S6k): changes come in bursts, so a refresh waits for a pause
 * (with a ceiling on the wait); only editors showing are decorated; an editor
 * whose chips would be the same is not touched; one editor failing does not
 * stop the others.
 */
export class InlineDiagnosticsRefresher {
  private handle: unknown;
  private firstAt: number | undefined;
  private readonly drawn = new Map<string, string>();

  constructor(
    private readonly ports: RefresherPorts,
    private readonly timers: Timers = REAL,
  ) {}

  /** The markers of `uri` changed: only worth a refresh when an editor showing it exists. */
  markersChanged(uri: string): void {
    if (this.ports.editors().some((e) => e.visible && e.uri === uri)) this.schedule();
  }

  /** Something else changed (the preference, an editor's layout, content, visibility, the active editor). */
  schedule(): void {
    const now = this.timers.now();
    this.firstAt ??= now;
    if (this.handle !== undefined) this.timers.clear(this.handle);
    const wait = Math.max(0, Math.min(REFRESH_MS, this.firstAt + MAX_WAIT_MS - now));
    this.handle = this.timers.set(() => this.refresh(), wait);
  }

  /** Decorate the editors showing, clear the others and all of them when the feature is off. */
  refresh(): void {
    if (this.handle !== undefined) this.timers.clear(this.handle);
    this.handle = undefined;
    this.firstAt = undefined;
    const on = this.ports.enabled();
    const open = new Set<string>();
    for (const editor of this.ports.editors()) {
      open.add(editor.key);
      try {
        if (!on || !editor.visible) {
          if (!on && this.drawn.has(editor.key)) editor.clear();
          if (!on) this.drawn.delete(editor.key);
          continue;
        }
        const shown = inlineDiagnostics(editor.markers(), editor.layout());
        const key = keyOf(shown);
        if (this.drawn.get(editor.key) === key) continue;
        editor.apply(shown);
        this.drawn.set(editor.key, key);
      } catch (err) {
        this.ports.warn(`inline diagnostics could not be drawn for ${editor.uri}`, err);
      }
    }
    // An editor that closed takes its cache entry with it.
    for (const key of [...this.drawn.keys()]) if (!open.has(key)) this.drawn.delete(key);
  }

  dispose(): void {
    if (this.handle !== undefined) this.timers.clear(this.handle);
    this.handle = undefined;
  }
}
