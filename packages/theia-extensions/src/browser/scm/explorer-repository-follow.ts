import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { SelectionService } from "@theia/core/lib/common/selection-service";
import { UriSelection } from "@theia/core/lib/common/selection";
import { SpexrGitScmRegistry } from "./git-scm-registry.js";

/**
 * Makes the repository the SCM panel (and the status bar's branch) shows follow
 * the file or folder selected in the Explorer. In a multi-root workspace the
 * panel kept whichever repository was picked first, so the branch on display
 * could belong to a different root than the one being browsed.
 */
@injectable()
export class ExplorerRepositoryFollow implements FrontendApplicationContribution {
  @inject(SelectionService) private readonly selection!: SelectionService;
  @inject(SpexrGitScmRegistry) private readonly registry!: SpexrGitScmRegistry;

  onStart(): void {
    this.selection.onSelectionChanged((selection) => {
      const uri = UriSelection.getUri(selection);
      if (uri) this.registry.selectRepositoryFor(uri.toString());
    });
  }
}
