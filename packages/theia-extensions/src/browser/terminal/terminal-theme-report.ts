/** Called with a CSI sequence's parameters; `false` leaves the sequence to xterm's own handler. */
export type CsiHandler = (params: (number | number[])[]) => boolean;

/** The slice of xterm's public `term.parser` that mode tracking needs. */
export interface CsiParserLike {
  registerCsiHandler(id: { prefix?: string; final: string }, callback: CsiHandler): { dispose(): void };
}

/** Whether a program in the terminal has asked to hear about theme changes. */
export interface ThemeReportTracker {
  readonly enabled: boolean;
  dispose(): void;
}

/** DEC private mode for "report colour-scheme changes" (contour's spec, adopted by Claude Code). */
const THEME_REPORT_MODE = 2031;

/**
 * Watches a terminal for `CSI ? 2031 h` / `l`, which xterm 5.3 does not know.
 *
 * Claude Code in its "Auto (match terminal)" theme sets this mode, then re-reads
 * the terminal background (OSC 11, which xterm does answer) each time a
 * {@link themeReport} arrives. Without it, a running session keeps the theme it
 * started with. The handlers only observe: xterm still sees every sequence.
 */
export function trackThemeReports(parser: CsiParserLike): ThemeReportTracker {
  let enabled = false;
  const watch = (final: "h" | "l"): { dispose(): void } =>
    parser.registerCsiHandler({ prefix: "?", final }, (params) => {
      if (params.includes(THEME_REPORT_MODE)) enabled = final === "h";
      return false;
    });
  const handlers = [watch("h"), watch("l")];
  return {
    get enabled() {
      return enabled;
    },
    dispose: () => handlers.forEach((h) => h.dispose()),
  };
}

/** The report a terminal sends its program when the colour scheme changes: `1` dark, `2` light. */
export function themeReport(dark: boolean): string {
  return `\x1b[?997;${dark ? 1 : 2}n`;
}

