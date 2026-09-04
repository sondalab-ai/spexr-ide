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
import { buildFileUri } from "./git-scm-provider.js";
import { SpexrGitScmRegistry } from "./git-scm-registry.js";
import { decorationForFile } from "./git-state-decoration-format.js";

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
 * Unions every repository in the workspace rather than following the SCM
 * panel's selection: the file navigator shows all workspace folders at once, so
 * a selection-scoped map would silently strip the state letters off every file
 * outside the repository currently picked.
 *
 * Fed entirely by the registry's status events — no git call of its own.
 */
@injectable()
export class GitStateDecorationProvider
  implements DecorationsProvider, FrontendApplicationContribution
{
  @inject(SpexrGitScmRegistry) private readonly registry!: SpexrGitScmRegistry;
  @inject(DecorationsService) private readonly decorations!: DecorationsService;

  private readonly onDidChangeEmitter = new Emitter<URI[]>();
  readonly onDidChange: Event<URI[]> = this.onDidChangeEmitter.event;

  private byUri = new Map<string, Decoration>();

  onStart(): void {
    this.decorations.registerDecorationsProvider(this);
    this.registry.onDidChangeStatus(() => this.apply());
    this.registry.onDidChangeProviders(() => this.apply());
    this.apply();
  }

  provideDecorations(uri: URI): Decoration | undefined {
    return this.byUri.get(uri.toString());
  }

  private apply(): void {
    const previousUris = [...this.byUri.keys()];
    const nextUris = new Map<string, Decoration>();
    for (const provider of this.registry.all) {
      const root = provider.root;
      const status = provider.lastStatus;
      if (!root || !status) continue;
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
