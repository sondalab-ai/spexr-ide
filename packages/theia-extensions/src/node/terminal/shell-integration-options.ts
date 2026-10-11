/**
 * What spexr changes in the shell integration Theia injects (S6l), free of
 * Theia so it runs in plain node. Theia's injector starts bash with
 * `--rcfile <its script>` and zsh with a ZDOTDIR of its own and THEIA_ZSH_DIR;
 * spexr puts its own script in front of each, which chains Theia's (so the
 * user's rc files are still sourced, by Theia's own code) and adds the
 * `spexr_finished` mark after each command.
 */

export interface ShellLaunch {
  shell?: string | undefined;
  args?: string | string[] | undefined;
  env?: Record<string, string | null | undefined> | undefined;
}

/** Where spexr's scripts are: absent paths mean the scripts were not shipped, and nothing is changed. */
export interface SpexrScripts {
  readonly bashRcfile: string | undefined;
  readonly zshDir: string | undefined;
  /**
   * A path a child process can read: inside the packaged app the backend
   * runs from an asar archive, which Electron's fs reads but a shell cannot,
   * so a script goes by its unpacked copy. Applied to Theia's paths too.
   */
  readonly real?: (path: string) => string;
}

/** `path` in the asar's unpacked twin, when there is one (`exists` says so); otherwise as it is. */
export function unpackedPath(path: string, exists: (p: string) => boolean): string {
  const twin = path.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return twin !== path && exists(twin) ? twin : path;
}

/**
 * Whether the shell is told to run a command (`-c`, `-lc`, `-ic`), as the agent
 * terminal and the Dark Factory sessions are: those are a CLI's terminal, not a
 * prompt with commands, so they get no blocks.
 */
export function isCommandRun(args: string | string[] | undefined): boolean {
  const list = typeof args === "string" ? args.trim().split(/\s+/) : (args ?? []);
  return list.some((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
}

/**
 * `injected` (what Theia's injector made of `original`) with spexr's script
 * in front of Theia's: bash's `--rcfile` becomes spexr's, which is handed
 * Theia's in `SPEXR_THEIA_BASH_RCFILE`; zsh's THEIA_ZSH_DIR becomes spexr's,
 * with Theia's in `SPEXR_THEIA_ZSH_DIR`. Unchanged when Theia injected nothing
 * (another shell, a missing script), when the shell runs a command, or when
 * spexr's script is not there.
 */
export function withSpexrBlocks<T extends ShellLaunch>(original: T, injected: T, scripts: SpexrScripts): T {
  if (injected === original) return injected;
  if (isCommandRun(original.args)) return original;
  const real = scripts.real ?? ((p: string) => p);
  const args = injected.args;
  if (Array.isArray(args) && args[0] === "--rcfile" && typeof args[1] === "string") {
    if (!scripts.bashRcfile) return injected;
    return { ...injected, args: ["--rcfile", scripts.bashRcfile, ...args.slice(2)], env: { ...injected.env, SPEXR_THEIA_BASH_RCFILE: real(args[1]) } };
  }
  const theiaZsh = injected.env?.THEIA_ZSH_DIR;
  if (typeof theiaZsh === "string" && theiaZsh) {
    if (!scripts.zshDir) return injected;
    return { ...injected, env: { ...injected.env, THEIA_ZSH_DIR: scripts.zshDir, SPEXR_THEIA_ZSH_DIR: real(theiaZsh) } };
  }
  return injected;
}
