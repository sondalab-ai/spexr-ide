import { existsSync } from "node:fs";
import { join } from "node:path";
import { injectable } from "@theia/core/shared/inversify";
import { ShellIntegrationInjector } from "@theia/terminal/lib/node/shell-integration-injector";
import type { ShellProcessOptions } from "@theia/terminal/lib/node/shell-process";
import { unpackedPath, withSpexrBlocks, type SpexrScripts } from "./shell-integration-options.js";

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
 * Theia's shell integration plus spexr's command-block mark (S6l). The scripts
 * chain Theia's own, so the user's rc files and Theia's command tracking keep
 * working; fish and PowerShell get nothing, as with Theia's.
 */
@injectable()
export class SpexrShellIntegrationInjector extends ShellIntegrationInjector {
  override injectShellIntegration(options: ShellProcessOptions): ShellProcessOptions {
    const theia = super.injectShellIntegration(options);
    const found = scripts();
    const injected = withSpexrBlocks(options, theia, found);
    // One line per terminal in the backend log: what went in and why not, for which shell.
    console.info(
      `[spexr] shell integration for ${options.shell ?? "the default shell"} args=${JSON.stringify(options.args ?? [])}: ` +
        `${injected === options ? "none" : "theia + spexr command blocks"} (theia injected: ${theia !== options}, spexr scripts: bash ${found.bashRcfile ?? "missing"}, zsh ${found.zshDir ?? "missing"})`,
    );
    return injected;
  }
}
