import { injectable, inject } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { openTerminalAt, type DockShellLike, type TerminalOpenerLike } from "./project-terminal-open.js";

/**
 * Opens an ordinary shell terminal in the bottom panel, rooted at a directory.
 *
 * A thin adapter over {@link openTerminalAt}, which holds the sequence and the
 * reasoning: this class exists to bind Theia's services to it.
 */
@injectable()
export class SpexrProjectTerminalService {
  @inject(TerminalService) private readonly terminals!: TerminalService;
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;

  async openAt(directory: string, title: string): Promise<void> {
    await openTerminalAt(
      this.terminals as unknown as TerminalOpenerLike,
      this.shell as unknown as DockShellLike,
      directory,
      title,
    );
  }
}
