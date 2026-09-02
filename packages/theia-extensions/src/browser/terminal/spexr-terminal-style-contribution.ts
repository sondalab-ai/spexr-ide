import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import { TerminalThemeService } from "@theia/terminal/lib/browser/terminal-theme-service";
import { readTerminalStyle, terminalKindOf, xtermOptions, xtermTheme } from "./terminal-style.js";

/** The slice of the xterm instance we write to. */
interface XtermLike {
  options: Record<string, unknown> & { theme?: Record<string, string | undefined> };
}

/**
 * Applies the per-family terminal style preferences.
 *
 * Theia styles every terminal from one global source — `TerminalThemeService`
 * for colours and `terminal.integrated.*` for the font — and exposes no seam to
 * vary that per terminal: neither `TerminalWidgetOptions` nor the abstract
 * `TerminalWidget` carries anything about style. The only way to differ is to
 * write the xterm instance's own options, which the widget keeps in a protected
 * `term` field.
 *
 * That is private API and is treated as such: the access is guarded, so a Theia
 * release that renames the field costs us the styling, not a crash.
 *
 * Theia re-applies its global values whenever the colour theme or a terminal
 * preference changes (see `terminal-widget-impl`: the theme listener and the
 * preference handler both assign straight onto `term.options`). Our own values
 * are therefore re-applied *after* those events rather than in place of them,
 * which is what the deferral below is for — listener order is registration
 * order, and widgets created after this contribution would otherwise win.
 */
@injectable()
export class SpexrTerminalStyleContribution implements FrontendApplicationContribution {
  @inject(TerminalService) private readonly terminals!: TerminalService;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  @inject(TerminalThemeService) private readonly terminalTheme!: TerminalThemeService;

  onStart(): void {
    this.terminals.onDidCreateTerminal((widget) => this.applyLater(widget));
    this.terminalTheme.onDidChange(() => this.applyLater());
    this.preferences.onPreferenceChanged((event) => {
      if (
        event.preferenceName.startsWith("spexr.terminal.") ||
        event.preferenceName.startsWith("terminal.integrated.")
      ) {
        this.applyLater();
      }
    });
    this.applyAll();
  }

  /** Re-apply after Theia's own handlers for the same event have run. */
  private applyLater(widget?: TerminalWidget): void {
    setTimeout(() => (widget ? this.apply(widget) : this.applyAll()), 0);
  }

  private applyAll(): void {
    for (const widget of this.terminals.all) this.apply(widget);
  }

  private apply(widget: TerminalWidget): void {
    const xterm = this.xtermOf(widget);
    if (!xterm) return;
    const style = readTerminalStyle((key) => this.preferences.get(key), terminalKindOf(widget.kind));
    Object.assign(xterm.options, xtermOptions(style));
    const theme = xtermTheme(style, xterm.options.theme ?? {});
    // Assigning a theme redraws, so only do it when a colour is actually set.
    if (theme) xterm.options.theme = theme;
  }

  /** The widget's xterm instance, when this Theia still keeps it where we expect. */
  private xtermOf(widget: TerminalWidget): XtermLike | undefined {
    const term = (widget as unknown as { term?: unknown }).term;
    if (!term || typeof term !== "object") return undefined;
    const options = (term as { options?: unknown }).options;
    return options && typeof options === "object" ? (term as XtermLike) : undefined;
  }
}
