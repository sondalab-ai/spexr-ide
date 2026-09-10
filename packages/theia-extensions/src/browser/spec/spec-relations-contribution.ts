import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";

// Theia's `FileOperation` is a `const enum`, which cannot be referenced as a
// runtime value under `isolatedModules`. Mirror the relevant member here.
const FILE_OPERATION_MOVE = 2;
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type URI from "@theia/core/lib/common/uri";
import { SPEC_CONTEXT_DIR } from "../workspace-paths.js";
import { locateSpec, SPEC_SLUG_RE } from "./spec-roots.js";

/**
 * Keeps spec-related artefacts in sync when a spec file is renamed.
 *
 * When the user moves `docs/specs/<NNNN>-<old>.md` to `docs/specs/<NNNN>-<new>.md`,
 * the matching `docs/specs/.context/<NNNN>-<old>/` folder is renamed to
 * `docs/specs/.context/<NNNN>-<new>/`. Other operations (delete, copy) are ignored
 * to keep scope minimal.
 */
@injectable()
export class SpexrSpecRelationsContribution implements FrontendApplicationContribution {
  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  onStart(): void {
    this.fileService.onDidRunOperation((event) => void this.handleOperation(event));
  }

  private async handleOperation(event: FileOperationEvent): Promise<void> {
    if (event.operation !== FILE_OPERATION_MOVE) return;
    const target = event.target?.resource;
    if (!target) return;
    const source = event.resource;
    await this.syncSpecContextRename(source, target);
  }

  private async syncSpecContextRename(source: URI, target: URI): Promise<void> {
    const roots = this.workspaceRoots();
    const oldSlug = this.specSlugInWorkspace(source, roots);
    const newSlug = this.specSlugInWorkspace(target, roots);
    if (!oldSlug || !newSlug) return;
    if (oldSlug === newSlug) return;

    const contextRoot = source.parent.resolve(SPEC_CONTEXT_DIR);
    const oldDir = contextRoot.resolve(oldSlug);
    const newDir = contextRoot.resolve(newSlug);

    if (!(await this.exists(oldDir))) return;
    if (await this.exists(newDir)) {
      this.messages.warn(
        `Could not rename spec context: ${newSlug} already exists. Resolve manually.`,
      );
      return;
    }

    try {
      await this.fileService.move(oldDir, newDir);
      this.messages.info(`Renamed spec context ${oldSlug} → ${newSlug}.`);
    } catch (err) {
      console.error("[spexr] spec context rename failed", err);
      this.messages.error(
        `Spec context rename failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Slug of `uri` when it is a spec in any workspace folder, else undefined. */
  private specSlugInWorkspace(uri: URI, roots: readonly URI[]): string | undefined {
    if (!locateSpec(roots, uri)) return undefined;
    return uri.path.base.match(SPEC_SLUG_RE)?.[1];
  }

  private workspaceRoots(): URI[] {
    return this.workspace.tryGetRoots().map((root) => root.resource);
  }

  private async exists(uri: URI): Promise<boolean> {
    try {
      await this.fileService.resolve(uri);
      return true;
    } catch {
      return false;
    }
  }
}
