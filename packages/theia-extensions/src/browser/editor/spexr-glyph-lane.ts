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
