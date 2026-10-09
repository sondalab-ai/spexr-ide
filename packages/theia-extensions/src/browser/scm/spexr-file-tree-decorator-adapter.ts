import { injectable } from "@theia/core/shared/inversify";
import URI from "@theia/core/lib/common/uri";
import type { Decoration } from "@theia/core/lib/browser/decorations-service";
import type { TreeDecoration } from "@theia/core/lib/browser/tree/tree-decorator";
import { TopDownTreeIterator, type Tree } from "@theia/core/lib/browser";
import { FileTreeDecoratorAdapter } from "@theia/filesystem/lib/browser/file-tree/file-tree-decorator-adapter";
import { colorsName } from "./decoration-name-colour.js";

/**
 * The file tree's decorations with Lumen's letters only (S6b, L7): Theia's
 * adapter puts one colour on a row's name and on its tail letter, and this one
 * keeps it on the letter alone (decoration-name-colour.ts says where the name
 * keeps it). The Explorer's rows then read in one ink with a coloured "M" or
 * "U" at the end.
 *
 * Theia's adapter learns a file's decoration only from the service's change
 * events, so an Explorer created after git's status arrived shows no letters
 * until the next change (a problem mark's event used to cover for it). This
 * one asks the service for any decorated node it has not heard of when the
 * tree asks for its decorations.
 */
@injectable()
export class SpexrFileTreeDecoratorAdapter extends FileTreeDecoratorAdapter {
  override decorations(tree: Tree): ReturnType<FileTreeDecoratorAdapter["decorations"]> {
    this.learnMissing(tree);
    return super.decorations(tree);
  }

  /** Take in the decorations of the tree's nodes that the service has and this adapter has not seen. */
  private learnMissing(tree: Tree): void {
    if (!tree.root) return;
    const missing: string[] = [];
    for (const node of new TopDownTreeIterator(tree.root)) {
      const key = this.getUriForNode(node);
      if (key !== undefined && !this.decorationsByUri.has(key) && this.decorationsService.getDecoration(new URI(key), false).length > 0) missing.push(key);
    }
    if (missing.length > 0) this.updateDecorations(this.decorationsByUri.keys(), missing.values());
  }

  protected override toTheiaDecoration(decorations: Decoration[], bubble?: boolean): TreeDecoration.Data {
    const data = super.toTheiaDecoration(decorations, bubble);
    if (colorsName(decorations[0]?.colorId)) return data;
    const withoutName = { ...data };
    delete withoutName.fontData;
    return withoutName;
  }
}
