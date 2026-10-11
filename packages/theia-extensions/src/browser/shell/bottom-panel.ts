/**
 * The bottom panel's tabs as Lumen draws them (S6e, B1-B3, D21): Terminal,
 * Problems, Output, then the Agent log; shell terminals titled "Terminal",
 * "Terminal 2" and so on, and the Problems count tinted by its worst severity.
 *
 * Free of Theia, so the rules run in plain node.
 */

/** The Problems view's widget id (`PROBLEMS_WIDGET_ID`). */
export const PROBLEMS_VIEW_ID = "problems";
/** The Output view's widget id (`OutputWidget.ID`). */
export const OUTPUT_VIEW_ID = "outputView";
/** The Agent log's widget id (sessions/agent-log-widget.tsx, S6j); the order tolerates it being absent. */
export const AGENT_LOG_VIEW_ID = "spexr.view.agent-log";

/** What a shell terminal is called: "Terminal", then "Terminal 2", "Terminal 3". */
export const TERMINAL_TITLE = "Terminal";

/** Whether a title is one of ours, "Terminal" or "Terminal <n>" with n of 2 or more. */
export function isNumberedTerminalTitle(title: string): boolean {
  return title === TERMINAL_TITLE || /^Terminal [2-9]$|^Terminal [1-9]\d+$/.test(title);
}

/** The first title not in `taken`: "Terminal", else "Terminal 2", and so on, so a closed terminal's number is given again. */
export function nextTerminalTitle(taken: readonly string[]): string {
  if (!taken.includes(TERMINAL_TITLE)) return TERMINAL_TITLE;
  for (let n = 2; ; n++) if (!taken.includes(`${TERMINAL_TITLE} ${n}`)) return `${TERMINAL_TITLE} ${n}`;
}

/** How a bottom tab is ranked: terminals first, then Problems, Output and the Agent log; anything else after, in its own order. */
function rank(id: string): number {
  if (id === PROBLEMS_VIEW_ID) return 1;
  if (id === OUTPUT_VIEW_ID) return 2;
  if (id === AGENT_LOG_VIEW_ID) return 3;
  return id.startsWith("terminal-") ? 0 : 4;
}

/** The bottom bar's widget ids in Lumen's order. Stable, a fixed point, and indifferent to a tab that is not there. */
export function bottomOrder(ids: readonly string[]): string[] {
  return ids.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((e) => e.id);
}

/** The Problems chip's tone: the worst severity among the markers. Information and hints are neutral. */
export type ProblemSeverity = "error" | "warning" | "none";

/** LSP severities: 1 error, 2 warning, 3 information, 4 hint. A marker with none is an error, as the LSP says. */
export function problemSeverity(markers: ReadonlyArray<{ severity?: number | undefined }>): ProblemSeverity {
  let warning = false;
  for (const m of markers) {
    const severity = m.severity ?? 1;
    if (severity === 1) return "error";
    if (severity === 2) warning = true;
  }
  return warning ? "warning" : "none";
}
