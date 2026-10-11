/**
 * The editor breadcrumbs' words, free of Theia so they run in plain node
 * (S6c, E6 and E7): which symbol kinds read as calls, the ellipsis Theia
 * trails after the symbol path, and the right-hand meta "+14 −3 · not saved".
 */

/** The ellipsis crumb Theia's outline contribution appends for a symbol's children, or alone with no symbol selected. */
export const OUTLINE_ELLIPSIS = "…";

/** The minus sign the diff stat uses (U+2212), as Lumen's meta: wider than a hyphen, so it reads as a number's sign. */
export const MINUS = "−";

/** The kinds of the `codicon-symbol-<kind>` class an outline crumb carries that are called: functions and methods. */
const CALLABLE_KINDS: ReadonlySet<string> = new Set(["function", "method"]);

/** Whether the crumb's icon class names a function or a method symbol. */
export function isCallableSymbol(iconClass?: string): boolean {
  const kind = /(?:^|\s)codicon-symbol-([a-z-]+)(?:\s|$)/.exec(iconClass ?? "")?.[1];
  return kind !== undefined && CALLABLE_KINDS.has(kind);
}

/** The crumb's text: a function or method gets `()` ("resolve()"), as Lumen's; nothing else changes, and a name already ending in `)` is left alone. */
export function crumbText(label: string, iconClass?: string): string {
  return isCallableSymbol(iconClass) && !label.endsWith(")") ? `${label}()` : label;
}

/** Whether the crumb is the outline's "…" (a symbol's children, or the roots with no symbol selected). */
export function isOutlineEllipsis(label: string): boolean {
  return label === OUTLINE_ELLIPSIS;
}

/**
 * The crumbs as Lumen draws them: the outline's trailing "…" (after a symbol
 * crumb, standing for its children) is dropped. A lone "…", which is what the
 * outline gives with the cursor outside every symbol, stays, as the way into
 * the symbol picker. "After" means a crumb of the same type earlier in the row.
 */
export function visibleCrumbs<T extends { readonly label: string; readonly type: unknown }>(crumbs: readonly T[]): T[] {
  return crumbs.filter((crumb, i) => !(isOutlineEllipsis(crumb.label) && crumbs.slice(0, i).some((earlier) => earlier.type === crumb.type)));
}

/** Lines added and removed against the committed revision. */
export interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

/** The text appended after the stat when the editor holds unsaved edits. */
export const NOT_SAVED = "not saved";

/**
 * The breadcrumb meta: "+14 −3 · not saved". The stat shows only when it is
 * not 0/0 (or unknown), "not saved" only while the editor is dirty; empty
 * when neither applies.
 */
export function breadcrumbMeta(stats: DiffStats | undefined, dirty: boolean): string {
  const parts: string[] = [];
  if (stats && (stats.added > 0 || stats.removed > 0)) parts.push(`+${stats.added} ${MINUS}${stats.removed}`);
  if (dirty) parts.push(NOT_SAVED);
  return parts.join(" · ");
}
