import { describe, expect, it } from "vitest";
import type { Menu } from "@theia/core/shared/@lumino/widgets";
import type { VirtualElement } from "@theia/core/shared/@lumino/virtualdom";
import { acceleratorKeys, installMenuKeycaps, shortcutCaps } from "./menu-keycaps.js";

/** A virtual element's markup, without a DOM: tag, class and text children. */
function markup(node: VirtualElement): string {
  const children = node.children.map((child) => (child.type === "text" ? child.content : markup(child))).join("");
  return `<${node.tag} class="${node.attrs.className ?? ""}">${children}</${node.tag}>`;
}

describe("acceleratorKeys", () => {
  it("splits a chord on the + Theia joins its keys with", () => {
    expect(acceleratorKeys("Ctrl+Shift+P")).toEqual(["Ctrl", "Shift", "P"]);
    expect(acceleratorKeys("F1")).toEqual(["F1"]);
    expect(acceleratorKeys("Cmd+=")).toEqual(["Cmd", "="]);
  });

  it("keeps a + that ends the chord as the key itself", () => {
    expect(acceleratorKeys("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(acceleratorKeys("Ctrl+Shift++")).toEqual(["Ctrl", "Shift", "+"]);
    expect(acceleratorKeys("+")).toEqual(["+"]);
  });
});

describe("shortcutCaps", () => {
  it("draws one kit keycap per key, with the separators kept as text for the item's name", () => {
    expect(shortcutCaps(["Ctrl+K", "Ctrl+S"]).map(markup).join("")).toBe(
      '<kbd class="sl-kbd">Ctrl</kbd><span class="spexr-key-sep">+</span><kbd class="sl-kbd">K</kbd>' +
        '<span class="spexr-key-sep spexr-key-sep--chord">, </span>' +
        '<kbd class="sl-kbd">Ctrl</kbd><span class="spexr-key-sep">+</span><kbd class="sl-kbd">S</kbd>',
    );
  });
});

// The frontend module installs it on Lumino's shared default renderer (Lumino's
// widgets need a DOM to load, so a stand-in renderer is used here).
describe("installMenuKeycaps", () => {
  const data = (keys?: string[]): Menu.IRenderData => ({ item: { keyBinding: keys ? { keys } : null } }) as unknown as Menu.IRenderData;

  it("makes the renderer draw a shortcut's keys as keycaps, and nothing for an item without keys", () => {
    const renderer: Pick<Menu.Renderer, "formatShortcut"> = { formatShortcut: () => "Ctrl+Shift+P" };
    installMenuKeycaps(renderer);
    const caps = renderer.formatShortcut(data(["Ctrl+Shift+P"])) as VirtualElement[];
    expect(caps.map(markup).join("")).toBe(
      '<kbd class="sl-kbd">Ctrl</kbd><span class="spexr-key-sep">+</span>' +
        '<kbd class="sl-kbd">Shift</kbd><span class="spexr-key-sep">+</span><kbd class="sl-kbd">P</kbd>',
    );
    expect(renderer.formatShortcut(data())).toBeNull();
    expect(renderer.formatShortcut(data([]))).toBeNull();
  });
});
