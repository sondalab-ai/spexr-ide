/** The slice of the xterm instance that Unicode width handling needs. */
export interface XtermUnicodeLike {
  options: { allowProposedApi?: boolean | undefined };
  loadAddon(addon: unknown): void;
  readonly unicode: { activeVersion: string };
}

/**
 * Switches a terminal to Unicode 11 character widths.
 *
 * xterm defaults to its Unicode 6 table, where every emoji above U+1FFFF is one
 * cell wide. Claude Code lays its screen out with two cells per emoji, so each
 * emoji shifts xterm's cursor one column left of where Claude Code thinks it is:
 * glyphs overlap their neighbours, and the diff renderer leaves stale cells
 * behind (a status line showing "fmain" after a switch from "fix/…" to "main").
 *
 * `term.unicode` is a proposed API. Theia ties `allowProposedApi` to its
 * command-history preference, so it is opened only for the switch and then put
 * back; the active version is terminal state and outlives the flag. A terminal
 * already on Unicode 11 is left alone, so repeat calls add no second addon.
 */
export function enableUnicode11(term: XtermUnicodeLike, createAddon: () => unknown): void {
  const allowed = term.options.allowProposedApi;
  term.options.allowProposedApi = true;
  try {
    if (term.unicode.activeVersion === "11") return;
    term.loadAddon(createAddon());
    term.unicode.activeVersion = "11";
  } finally {
    term.options.allowProposedApi = allowed;
  }
}
