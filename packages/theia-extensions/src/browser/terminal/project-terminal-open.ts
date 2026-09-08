/**
 * The parts of Theia's `TerminalService` and `ApplicationShell` this needs.
 *
 * Structural rather than nominal so the sequence below can be unit-tested with
 * plain objects — importing `ApplicationShell` as a value drags in Lumino's DOM
 * code, which a node test environment has no `document` for.
 */
export interface TerminalOpenerLike {
  newTerminal(options: Record<string, unknown>): Promise<{ id: string; start(): Promise<void> }>;
}

export interface DockShellLike {
  addWidget(widget: { id: string }, options: { area: string }): Promise<void> | void;
  activateWidget(id: string): Promise<unknown>;
}

/**
 * Start an ordinary shell in the bottom panel, rooted at `directory`.
 *
 * Always a fresh terminal, never a `cd` typed into one that is already open: an
 * existing terminal may be sitting in a pager, an editor, or a prompt, where a
 * line of injected text is at best noise and at worst an answer nobody meant to
 * give. Starting in the right directory needs no command at all.
 *
 * The terminal carries no `kind` marker on purpose, so `terminalKindOf` reads it
 * as an ordinary Theia terminal: it takes `terminal.integrated.*` styling rather
 * than the session or agent families, which is what it is.
 *
 * No-op on an empty path — there is no directory to open at.
 */
export async function openTerminalAt(
  terminals: TerminalOpenerLike,
  shell: DockShellLike,
  directory: string,
  title: string,
): Promise<void> {
  if (!directory) return;
  const term = await terminals.newTerminal({
    title,
    useServerTitle: false,
    iconClass: "codicon codicon-terminal",
    cwd: directory,
  });
  await term.start();
  await shell.addWidget(term, { area: "bottom" });
  await shell.activateWidget(term.id);
}
