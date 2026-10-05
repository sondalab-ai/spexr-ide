import type { Menu } from "@theia/core/shared/@lumino/widgets";
import { h, type VirtualElement } from "@theia/core/shared/@lumino/virtualdom";

/**
 * The keys of one chord of a Theia menu accelerator ("Ctrl+Shift+P",
 * "Cmd+="). Theia joins a chord's keys with "+", so a "+" separates keys
 * unless it ends the chord, where it is the key itself ("Ctrl++").
 */
export function acceleratorKeys(chord: string): string[] {
  return chord.split(/\+(?!$)/).filter((key) => key !== "");
}

/**
 * A shortcut as one kit keycap per key. The "+" between keys and the ", "
 * between chords stay in the DOM as text (spexr.css hides them), so the
 * menu item's accessible name still reads "Ctrl+Shift+P".
 */
export function shortcutCaps(chords: readonly string[]): VirtualElement[] {
  return chords.flatMap((chord, i) => [
    ...(i > 0 ? [h.span({ className: "spexr-key-sep spexr-key-sep--chord" }, ", ")] : []),
    ...acceleratorKeys(chord).flatMap((key, j) => [
      ...(j > 0 ? [h.span({ className: "spexr-key-sep" }, "+")] : []),
      h.kbd({ className: "sl-kbd" }, key),
    ]),
  ]);
}

/**
 * Draws a browser menu's shortcut as one keycap per key, on the renderer it
 * is given. The frontend module gives it Lumino's shared default renderer,
 * which every Theia browser menu is built on (the menu bar's menus with the
 * custom title bar, and context menus, on Windows and Linux; macOS menus are
 * native), as Theia offers no hook of its own. A menu with a renderer of its
 * own keeps its text.
 */
export function installMenuKeycaps(renderer: Pick<Menu.Renderer, "formatShortcut">): void {
  renderer.formatShortcut = (data) => {
    const keys = data.item.keyBinding?.keys;
    return keys && keys.length > 0 ? shortcutCaps(keys) : null;
  };
}
