import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { injectable } from "@theia/core/shared/inversify";
import { guessShellTypeFromExecutable } from "@theia/terminal/lib/common/shell-type";
import { ShellProcess } from "@theia/terminal/lib/node/shell-process";
import { ShellIntegrationInjector } from "@theia/terminal/lib/node/shell-integration-injector";
import type { ShellProcessOptions } from "@theia/terminal/lib/node/shell-process";
import { isCommandRun, theiaInjection, unpackedPath, withSpexrBlocks, type IntegratedShell, type SpexrScripts } from "./shell-integration-options.js";

/**
 * spexr's scripts, in `shell-integrations/spexr` beside Theia's own: in `lib/node/terminal`
 * (package.json `copy-assets`) and in the bundled backend `lib/backend` (apps/desktop/esbuild.mjs).
 */
const ROOT = join(__dirname, "shell-integrations", "spexr");

function scripts(): SpexrScripts {
  const real = (p: string): string => unpackedPath(p, existsSync);
  const bash = join(ROOT, "bash", "spexr-bash-integration.bash");
  const zsh = join(ROOT, "zsh");
  return {
    bashRcfile: existsSync(bash) ? real(bash) : undefined,
    zshDir: existsSync(join(zsh, "zsh-integration.zsh")) ? real(zsh) : undefined,
    real,
  };
}

/**
 * Where Theia's own scripts are when its injector could not find them: in its
 * package's `src` (a development run, compiled `lib` without a bundle), the
 * place its bundler copies them from.
 */
function theiaScriptsDir(): string | undefined {
  try {
    const dir = join(dirname(require.resolve("@theia/terminal/package.json")), "src", "node", "shell-integrations");
    return existsSync(join(dir, "bash", "bash-integration.bash")) ? dir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Theia's shell integration plus spexr's command-block mark (S6l). The scripts
 * chain Theia's own, so the user's rc files and Theia's command tracking keep
 * working; fish and PowerShell get nothing, as with Theia's. Where Theia
 * finds no scripts of its own (a run without a bundle) spexr does what Theia
 * would, from the package's sources.
 */
@injectable()
export class SpexrShellIntegrationInjector extends ShellIntegrationInjector {
  override injectShellIntegration(options: ShellProcessOptions): ShellProcessOptions {
    let theia = super.injectShellIntegration(options);
    let how = "theia";
    if (theia === options && !isCommandRun(options.args)) {
      const dir = theiaScriptsDir();
      const shell = guessShellTypeFromExecutable(options.shell ?? ShellProcess.getShellExecutablePath()) as unknown as IntegratedShell;
      if (dir && (shell === "bash" || shell === "zsh")) {
        theia = theiaInjection(options, shell, dir, process.env.ZDOTDIR);
        how = "spexr (theia's scripts from the package's sources)";
      }
    }
    const found = scripts();
    const injected = withSpexrBlocks(options, theia, found);
    // One line per terminal in the backend log: what went in and why not, for which shell.
    console.info(
      `[spexr] shell integration for ${options.shell ?? "the default shell"} args=${JSON.stringify(options.args ?? [])}: ` +
        `${injected === options ? "none" : `${how} + spexr command blocks`} (theia injected: ${theia !== options}, spexr scripts: bash ${found.bashRcfile ?? "missing"}, zsh ${found.zshDir ?? "missing"})`,
    );
    return injected;
  }
}
