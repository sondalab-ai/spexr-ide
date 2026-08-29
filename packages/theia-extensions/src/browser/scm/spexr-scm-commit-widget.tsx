import * as React from "@theia/core/shared/react";
import { inject, injectable } from "@theia/core/shared/inversify";
import { CommandRegistry } from "@theia/core";
import { ContextMenuRenderer } from "@theia/core/lib/browser";
import { ScmCommitWidget } from "@theia/scm/lib/browser/scm-commit-widget";
import type { ScmInput } from "@theia/scm/lib/browser/scm-input";
import { GitCommands } from "./git-commands-contribution.js";

/**
 * Theia's commit widget with the "write this for me" action inside the message
 * box, where the message is written rather than off in the panel toolbar.
 *
 * Wraps `super.renderInput` instead of reimplementing it: the original composes
 * the validation status, the accept keybinding and an autosizing textarea, and a
 * copy of that here would drift silently at the next Theia upgrade.
 */
@injectable()
export class SpexrScmCommitWidget extends ScmCommitWidget {
  @inject(CommandRegistry)
  private readonly commands!: CommandRegistry;

  /** True while the local model is writing: the action spins and refuses re-entry. */
  private generating = false;

  constructor(@inject(ContextMenuRenderer) contextMenuRenderer: ContextMenuRenderer) {
    super(contextMenuRenderer);
  }

  protected override renderInput(input: ScmInput): React.ReactNode {
    return (
      <div className="spexr-scm-input">
        {super.renderInput(input)}
        <button
          className="spexr-scm-input__generate"
          title="Write the commit message with the local model"
          disabled={this.generating}
          onClick={() => void this.generate()}
        >
          <i
            className={
              this.generating ? "codicon codicon-loading codicon-modifier-spin" : "codicon codicon-sparkle"
            }
          />
        </button>
      </div>
    );
  }

  /**
   * The command owns the guards and the messaging; this only keeps the button
   * from being pressed again while one inference is already in flight.
   */
  private async generate(): Promise<void> {
    if (this.generating) return;
    this.generating = true;
    this.update();
    try {
      await this.commands.executeCommand(GitCommands.GENERATE_MESSAGE.id);
    } finally {
      this.generating = false;
      this.update();
    }
  }
}
