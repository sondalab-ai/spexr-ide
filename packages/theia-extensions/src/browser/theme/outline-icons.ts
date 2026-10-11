/**
 * The "spexr outline" icon theme's mapping (S6f, D10): Lumen draws a file and
 * a folder as a 14px outline glyph in the muted ink, the accent on the current
 * tab and the selected row. Two codicons stand for them, `file` and `folder`
 * (`folder-opened` takes the folder's place while it is expanded, in the style
 * sheet, since a label provider is not told the tree's state).
 *
 * Free of Theia, so the mapping is tested in plain node.
 */

/** The theme's id, as `workbench.iconTheme` names it. */
export const OUTLINE_ICON_THEME_ID = "spexr-outline";

/** What the theme draws: a file or a folder. */
export type OutlineKind = "file" | "folder";

/** The class every glyph of the theme carries: the style sheet's hook for its size, ink and the opened folder. */
export const OUTLINE_ICON_CLASS = "spexr-outline-icon";

/** The class that marks a folder's glyph, which the style sheet swaps for the opened one. */
export const OUTLINE_FOLDER_CLASS = "spexr-outline-icon--folder";

/** The part of an element the mapping reads: a URI, a `URIIconReference` or a `FileStat`, structurally. */
export interface IconElement {
  readonly kind?: unknown;
  readonly id?: unknown;
  readonly isDirectory?: boolean;
}

/** Whether the element is a folder: an icon reference to one, or a file stat that is a directory. A bare URI is a file. */
export function outlineKindOf(element: IconElement): OutlineKind {
  if (element.kind === "uriIconReference") return element.id === "folder" ? "folder" : "file";
  return element.isDirectory === true ? "folder" : "file";
}

/** The icon class string for a kind: the codicon, the theme's hook and, for a folder, its marker. */
export function outlineIconClass(kind: OutlineKind): string {
  return kind === "folder" ? `codicon codicon-folder ${OUTLINE_ICON_CLASS} ${OUTLINE_FOLDER_CLASS}` : `codicon codicon-file ${OUTLINE_ICON_CLASS}`;
}
