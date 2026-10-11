/**
 * The "spexr outline" icon theme's mapping (S6f, D10): Lumen draws a file and
 * a folder as a 14px outline glyph in the muted ink, the accent on the current
 * tab and the selected row. Two codicons stand for them, `file` and `folder`
 * (every directory is the one closed folder, as the demo draws it).
 *
 * Free of Theia's browser classes (it needs only the common `URI`), so the
 * mapping is tested in plain node.
 */

import URI from "@theia/core/lib/common/uri";

/** The theme's id, as `workbench.iconTheme` names it. */
export const OUTLINE_ICON_THEME_ID = "spexr-outline";

/** What the theme draws: a file or a folder. */
export type OutlineKind = "file" | "folder";

/**
 * The codicon glyphs the two classes draw, pinned here (the codicon font is a
 * transitive dependency, not one to read the stylesheet of): the capture checks
 * the computed glyph against these, so a directory that is not the closed
 * folder (the opened one is \ueaf7) is seen.
 */
export const OUTLINE_GLYPH = { file: "\uea7b", folder: "\uea83" } as const;

/** The class every glyph of the theme carries: the style sheet's hook for its size and ink. */
export const OUTLINE_ICON_CLASS = "spexr-outline-icon";

/** The class that marks a folder's glyph, which the capture finds the tree's folder rows by. */
export const OUTLINE_FOLDER_CLASS = "spexr-outline-icon--folder";

/**
 * Whether the theme draws an element, by what it is and its scheme: a `file:`
 * URI, a `file:` file stat, or an icon reference with a `file:` URI or none
 * (the generic file and folder). Nothing else: a diff URI (`diff:`, which the
 * editor draws as a split icon), an `untitled:` or `git:` one, and the AI
 * variable URIs keep their own icons. As Theia's plugin icon themes do.
 */
export function handlesElement(facts: { readonly kind: "uri" | "iconReference" | "fileStat" | "other"; readonly scheme?: string | undefined }): boolean {
  switch (facts.kind) {
    case "uri":
    case "fileStat":
      return facts.scheme === "file";
    case "iconReference":
      return facts.scheme === undefined || facts.scheme === "file";
    default:
      return false;
  }
}

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

/** The priority the theme answers with while it is active: above the label provider's defaults, as Theia's "none" theme. */
export const OUTLINE_PRIORITY = Number.MAX_SAFE_INTEGER - 1024;

/** What an element is and its scheme, read structurally (a URI, a `URIIconReference`, a `FileStat`), as `handlesElement` takes it. */
export function factsOf(element: object): Parameters<typeof handlesElement>[0] {
  if (element instanceof URI) return { kind: "uri", scheme: element.scheme };
  const candidate = element as { kind?: unknown; uri?: unknown; resource?: unknown };
  if (candidate.kind === "uriIconReference") return { kind: "iconReference", scheme: candidate.uri instanceof URI ? candidate.uri.scheme : undefined };
  if (candidate.resource instanceof URI) return { kind: "fileStat", scheme: candidate.resource.scheme };
  return { kind: "other" };
}

/** The theme's answer for an element: its priority, or 0 while it is not the active theme or for an element it does not draw. */
export function outlineCanHandle(element: object, active: boolean): number {
  return active && handlesElement(factsOf(element)) ? OUTLINE_PRIORITY : 0;
}
