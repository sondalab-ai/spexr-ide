import { injectable } from "@theia/core/shared/inversify";
import type { Decoration } from "@theia/core/lib/browser/decorations-service";
import type { TreeDecoration } from "@theia/core/lib/browser/tree/tree-decorator";
import { FileTreeDecoratorAdapter } from "@theia/filesystem/lib/browser/file-tree/file-tree-decorator-adapter";
import { colorsName } from "./decoration-name-colour.js";

/**
 * The file tree's decorations with Lumen's letters only (S6b, L7): Theia's
 * adapter puts one colour on a row's name and on its tail letter, and this one
 * keeps it on the letter alone (decoration-name-colour.ts says where the name
 * keeps it). The Explorer's rows then read in one ink with a coloured "M" or
 * "U" at the end.
 */
@injectable()
export class SpexrFileTreeDecoratorAdapter extends FileTreeDecoratorAdapter {
  protected override toTheiaDecoration(decorations: Decoration[], bubble?: boolean): TreeDecoration.Data {
    const data = super.toTheiaDecoration(decorations, bubble);
    if (colorsName(decorations[0]?.colorId)) return data;
    const withoutName = { ...data };
    delete withoutName.fontData;
    return withoutName;
  }
}
