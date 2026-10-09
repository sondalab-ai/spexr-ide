import { inject, injectable, optional, postConstruct } from "@theia/core/shared/inversify";
import URI from "@theia/core/lib/common/uri";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { BreakpointManager } from "@theia/debug/lib/browser/breakpoint/breakpoint-manager";
import { DebugSessionManager } from "@theia/debug/lib/browser/debug-session-manager";
import { GlyphLaneModel } from "./spexr-glyph-lane.js";

/**
 * Theia's side of the glyph lane (spexr-glyph-lane.ts): reads the preference,
 * the breakpoints and the debug sessions into a {@link GlyphLaneModel}. The
 * editor provider asks it for the option of an editor it creates; the
 * contribution updates the editors that are open. The debug managers are
 * optional: without them there is nothing to show a lane for.
 */
@injectable()
export class SpexrGlyphLane {
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  @inject(BreakpointManager) @optional() private readonly breakpoints?: BreakpointManager;
  @inject(DebugSessionManager) @optional() private readonly sessions?: DebugSessionManager;

  private model!: GlyphLaneModel;

  @postConstruct()
  protected init(): void {
    this.model = new GlyphLaneModel({
      inspect: () => undefined,
      inspectFor: (uri) => this.preferences.inspect<boolean>("editor.glyphMargin", uri),
      breakpointsIn: (uri) => this.breakpoints?.getBreakpoints(new URI(uri)).length ?? 0,
      sessionCount: () => this.sessions?.sessions.length ?? 0,
      subscriptions: [
        ...(this.breakpoints ? [(l: () => void) => this.breakpoints!.onDidChangeBreakpoints(l)] : []),
        ...(this.sessions ? [(l: () => void) => this.sessions!.onDidStartDebugSession(l), (l: () => void) => this.sessions!.onDidDestroyDebugSession(l)] : []),
      ],
    });
  }

  /** Calls `listener` when a breakpoint or a debug session changes. */
  onDidChange(listener: () => void): void {
    this.model.onDidChange(listener);
  }

  /** The `glyphMargin` option for an editor of `uri`, or undefined when its preference decides. */
  optionFor(uri: string): { glyphMargin: boolean } | undefined {
    return this.model.optionFor(uri);
  }
}
