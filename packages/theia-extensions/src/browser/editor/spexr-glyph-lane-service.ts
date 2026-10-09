import { inject, injectable, optional, postConstruct } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import URI from "@theia/core/lib/common/uri";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { BreakpointManager } from "@theia/debug/lib/browser/breakpoint/breakpoint-manager";
import { DebugSessionManager } from "@theia/debug/lib/browser/debug-session-manager";
import { glyphMarginOption } from "./spexr-glyph-lane.js";

/**
 * Reads where the glyph lane is wanted (spexr-glyph-lane.ts) from Theia's
 * preferences, breakpoints and debug sessions, and says when that changes.
 * The editor provider asks it for the option of an editor it creates; the
 * contribution updates the editors that are open. The debug managers are
 * optional: without them there is nothing to show a lane for.
 */
@injectable()
export class SpexrGlyphLane {
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  @inject(BreakpointManager) @optional() private readonly breakpoints?: BreakpointManager;
  @inject(DebugSessionManager) @optional() private readonly sessions?: DebugSessionManager;

  private readonly changed = new Emitter<void>();
  /** Fires when a breakpoint is added or removed, or a debug session starts or ends. */
  readonly onDidChange: Event<void> = this.changed.event;

  @postConstruct()
  protected init(): void {
    const fire = (): void => this.changed.fire();
    this.breakpoints?.onDidChangeBreakpoints(fire);
    this.sessions?.onDidStartDebugSession(fire);
    this.sessions?.onDidDestroyDebugSession(fire);
  }

  /** The `glyphMargin` option for an editor of `uri`, or undefined when its preference decides. */
  optionFor(uri: string): { glyphMargin: boolean } | undefined {
    return glyphMarginOption(
      {
        inspect: () => this.preferences.inspect<boolean>("editor.glyphMargin"),
        breakpointsIn: (u) => this.breakpoints?.getBreakpoints(new URI(u)).length ?? 0,
        sessionCount: () => this.sessions?.sessions.length ?? 0,
      },
      uri,
    );
  }
}
