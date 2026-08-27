import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter } from "@theia/core";
import type { Event } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import URI from "@theia/core/lib/common/uri";
import {
  DecorationsService,
  type DecorationsProvider,
  type Decoration,
} from "@theia/core/lib/browser/decorations-service";
import { SpexrGitScmProvider, buildFileUri } from "./git-scm-provider.js";
import { decorationForFile } from "./git-state-decoration-format.js";
import type { GitStatusDto } from "../../common/git-protocol.js";

/**
 * Supplies the `M`/`A`/`D`/`R`/`U`/`!` state letter and colour for each
 * changed file in the SCM panel. SPEXR ships a custom SCM (no `@theia/git`),
 * and Theia's tree row does NOT render the `ScmResourceDecorations` the
 * provider already attaches to each resource for this — it reads a
 * *different* `Decoration` type of the same field name from the
 * {@link DecorationsService} instead (see scm-tree-widget.js: `decoration.letter`
 * comes from `decorationsService.getDecoration`, not from `treeNode.decorations`,
 * which only ever supplies `icon`/`iconDark`/`strikeThrough`). This mirrors
 * {@link GitIgnoredDecorationProvider}, registered for the same reason.
 *
 * Fed entirely by {@link SpexrGitScmProvider.onDidChangeStatus} — no git call
 * of its own.
 */
@injectable()
export class GitStateDecorationProvider implements DecorationsProvider, FrontendApplicationContribution {
  @inject(SpexrGitScmProvider) private readonly provider!: SpexrGitScmProvider;
  @inject(DecorationsService) private readonly decorations!: DecorationsService;

  private readonly onDidChangeEmitter = new Emitter<URI[]>();
  readonly onDidChange: Event<URI[]> = this.onDidChangeEmitter.event;

  private byUri = new Map<string, Decoration>();

  onStart(): void {
    this.decorations.registerDecorationsProvider(this);
    this.provider.onDidChangeStatus((status) => this.apply(status));
    if (this.provider.lastStatus) this.apply(this.provider.lastStatus);
  }

  provideDecorations(uri: URI): Decoration | undefined {
    return this.byUri.get(uri.toString());
  }

  private apply(status: GitStatusDto | undefined): void {
    const root = this.provider.root;
    const previousUris = [...this.byUri.keys()];
    const nextUris = new Map<string, Decoration>();
    if (status && root) {
      for (const file of status.files) {
        const decoration = decorationForFile(file);
        if (!decoration) continue;
        nextUris.set(buildFileUri(root, file.path).toString(), decoration);
      }
    }
    this.byUri = nextUris;
    // Emit the previous + current URIs so the tree adapter re-queries both the
    // ones to newly decorate and the ones to clear (matching
    // GitIgnoredDecorationProvider's refresh).
    const changed = new Set([...previousUris, ...nextUris.keys()]);
    this.onDidChangeEmitter.fire([...changed].map((s) => new URI(s)));
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
