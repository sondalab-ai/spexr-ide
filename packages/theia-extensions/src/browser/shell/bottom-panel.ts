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
/** The Agent log's widget id (S6j adds the view); the order tolerates it being absent. */
export const AGENT_LOG_VIEW_ID = "spexr.view.agent-log";

/** What a shell terminal is called: "Terminal", then "Terminal 2", "Terminal 3". */
export const TERMINAL_TITLE = "Terminal";

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

/**
 * Where a widget that just joined the bar goes: the move to make (its id and
 * the index among the bar's other tabs), or undefined when it already sits
 * right. It goes before the first tab of higher rank, else last, and no other
 * tab moves, so a tab the user dragged stays where they put it. Lumino-free:
 * the contribution applies the move.
 */
export function moveForAdded(ids: readonly string[], addedId: string): { id: string; to: number } | undefined {
  const at = ids.indexOf(addedId);
  if (at < 0) return undefined;
  const others = ids.filter((id) => id !== addedId);
  const higher = others.findIndex((id) => rank(id) > rank(addedId));
  const to = higher < 0 ? others.length : higher;
  return to === at ? undefined : { id: addedId, to };
}

/** The bottom bar's widget ids in Lumen's order. Stable, a fixed point, and indifferent to a tab that is not there. */
export function bottomOrder(ids: readonly string[]): string[] {
  return ids.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((e) => e.id);
}

/** What decides whether a terminal is numbered: how it was made, read off the widget. */
export interface TerminalFacts {
  /** Theia's terminal kind: "user" for one made by a person, anything else by an extension on their behalf. */
  readonly kind?: string | undefined;
  /** The creator's `useServerTitle`: false means it named the terminal itself (a project's, a task's, the wall's). */
  readonly useServerTitle?: boolean | undefined;
  /** Theia's `hasUserTitle`: someone named it, or it was numbered already (`setTitle` sets it, and a restored layout keeps it). */
  readonly hasUserTitle?: boolean | undefined;
}

/**
 * The title a terminal is given, or undefined to leave it: only a shell terminal
 * nobody named (an ordinary user terminal that takes its title from the shell)
 * is numbered. The wall's, a project's, a task's and a plugin's terminals keep
 * the names their creators gave them. `taken` is every terminal's label, so the
 * number is the lowest free one: Theia's own default ("Terminal 4", counting
 * the agent's and the wall's terminals too) is replaced, not kept.
 */
export function titleFor(term: TerminalFacts, taken: readonly string[]): string | undefined {
  if ((term.kind ?? "user") !== "user") return undefined;
  if (term.useServerTitle === false) return undefined;
  if (term.hasUserTitle) return undefined;
  return nextTerminalTitle(taken);
}

/** The Problems chip's tone: the worst severity, as the chip's own count (`ProblemManager.getProblemStat`) has it. Information and hints are neutral. */
export type ProblemSeverity = "error" | "warning" | "none";

export function severityFromStat(stat: { readonly errors: number; readonly warnings: number }): ProblemSeverity {
  return stat.errors > 0 ? "error" : stat.warnings > 0 ? "warning" : "none";
}
