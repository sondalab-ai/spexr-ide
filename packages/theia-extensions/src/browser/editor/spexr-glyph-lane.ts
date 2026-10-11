/**
 * The glyph margin, the lane breakpoints and stack-frame markers are drawn in.
 * The demo's gutter has none, so it is off by default (`editor.glyphMargin:
 * false`); it is shown where debugging needs it: in an editor whose model has
 * breakpoints, and in every editor while a debug session is running, and
 * hidden again when neither is true. A value the user set wins over all of it.
 */
export interface GlyphLaneInputs {
  /** A user-scope, workspace or folder value of `editor.glyphMargin`; undefined when only the app's default is in force. */
  readonly explicit: boolean | undefined;
  /** At least one debug session is running. */
  readonly debugActive: boolean;
  /** Breakpoints set in this editor's model. */
  readonly modelBreakpoints: number;
}

/** Whether the lane should show, or undefined to leave the editor to its preference. */
export function glyphLane(input: GlyphLaneInputs): boolean | undefined {
  if (input.explicit !== undefined) return undefined;
  return input.debugActive || input.modelBreakpoints > 0;
}

/** The scopes of a preference inspection that a user (not the app) writes. */
export interface InspectedValues {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

/** The user's own `editor.glyphMargin`, narrowest scope first; undefined when none is set. */
export function explicitGlyphMargin(inspection: InspectedValues | undefined): boolean | undefined {
  for (const value of [inspection?.workspaceFolderValue, inspection?.workspaceValue, inspection?.globalValue]) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

/** What the service reads: the preference, the breakpoints of a model and the running sessions. */
export interface GlyphLaneSources {
  inspect(): InspectedValues | undefined;
  breakpointsIn(uri: string): number;
  sessionCount(): number;
}

/** The `glyphMargin` option to set on an editor of `uri`, or undefined to leave it alone. */
export function glyphMarginOption(sources: GlyphLaneSources, uri: string): { glyphMargin: boolean } | undefined {
  const lane = glyphLane({
    explicit: explicitGlyphMargin(sources.inspect()),
    debugActive: sources.sessionCount() > 0,
    modelBreakpoints: sources.breakpointsIn(uri),
  });
  return lane === undefined ? undefined : { glyphMargin: lane };
}

/** What the lane model reads and listens to; every source of change is a function that takes a listener. */
export interface GlyphLaneDeps extends GlyphLaneSources {
  /** The user's `editor.glyphMargin` for the resource, so a folder value of a multi-root workspace counts. */
  inspectFor(uri: string): InspectedValues | undefined;
  /** Subscriptions to breakpoint changes and session starts and ends; empty when debugging is not installed. */
  subscriptions: ReadonlyArray<(listener: () => void) => unknown>;
}

/** The lane decision for any editor, and a notice when it may have changed. Theia-free, so it is unit-tested. */
export class GlyphLaneModel {
  private readonly listeners: Array<() => void> = [];

  constructor(private readonly deps: GlyphLaneDeps) {
    for (const subscribe of deps.subscriptions) subscribe(() => this.listeners.forEach((l) => l()));
  }

  /** Calls `listener` when a breakpoint or a session changes. */
  onDidChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** The `glyphMargin` option for an editor of `uri`, or undefined when the user's preference decides. */
  optionFor(uri: string): { glyphMargin: boolean } | undefined {
    return glyphMarginOption({ ...this.deps, inspect: () => this.deps.inspectFor(uri) }, uri);
  }
}

/** The slice of an editor the lane updates: its Monaco control, which reports the options it holds (`getRawOptions`, merged by every `updateOptions`). */
export interface LaneEditor {
  readonly uri: { toString(): string };
  getControl(): { getRawOptions(): { glyphMargin?: boolean | undefined }; updateOptions(options: { glyphMargin: boolean }): void };
}

/**
 * Updates the open editors after a change: an editor gets `updateOptions` only
 * when the decision differs from the value it actually holds (read from its
 * control, so an editor created with the lane on during a session is turned
 * off after it), and an editor whose preference decides (no option) is never
 * touched.
 */
export function refreshGlyphLanes(editors: Iterable<LaneEditor>, model: Pick<GlyphLaneModel, "optionFor">): void {
  for (const editor of editors) {
    const option = model.optionFor(editor.uri.toString());
    const control = editor.getControl();
    if (!option || option.glyphMargin === (control.getRawOptions().glyphMargin ?? false)) continue;
    control.updateOptions(option);
  }
}
