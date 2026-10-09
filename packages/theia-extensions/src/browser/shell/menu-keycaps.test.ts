import { describe, expect, it } from "vitest";
import type { Menu } from "@theia/core/shared/@lumino/widgets";
import type { VirtualElement } from "@theia/core/shared/@lumino/virtualdom";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { acceleratorKeys, formatShortcutCaps, shortcutCaps } from "./menu-keycaps.js";

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

describe("formatShortcutCaps", () => {
  const data = (keys?: string[]): Pick<Menu.IRenderData, "item"> => ({ item: { keyBinding: keys ? { keys } : null } }) as unknown as Pick<Menu.IRenderData, "item">;

  it("draws a shortcut's keys as keycaps, and nothing for an item without keys", () => {
    expect(formatShortcutCaps(data(["Ctrl+Shift+P"]))!.map(markup).join("")).toBe(
      '<kbd class="sl-kbd">Ctrl</kbd><span class="spexr-key-sep">+</span>' +
        '<kbd class="sl-kbd">Shift</kbd><span class="spexr-key-sep">+</span><kbd class="sl-kbd">P</kbd>',
    );
    expect(formatShortcutCaps(data())).toBeNull();
    expect(formatShortcutCaps(data([]))).toBeNull();
  });
});

// Lumino's widgets need a DOM to load, so the wiring is read from source: a
// renderer of spexr's own, given to every menu Theia's Electron factory
// builds, and the factory bound over Theia's. Lumino's shared default
// renderer is left alone.
describe("the menu factory", () => {
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const factory = read("./menu-keycaps-factory.ts");

  it("renders shortcuts with the keycaps", () => {
    expect(factory).toMatch(/class KeycapMenuRenderer extends Menu\.Renderer \{\s*override formatShortcut\(data: Menu\.IRenderData\): h\.Child \{\s*return formatShortcutCaps\(data\);/);
  });

  it("gives every menu it builds that renderer, unless the menu has its own", () => {
    expect(factory).toMatch(/class SpexrElectronMainMenuFactory extends ElectronMainMenuFactory/);
    expect(factory).toContain("return super.createMenuWidget(parentPath, menu, contextMatcher, { ...options, renderer: options.renderer ?? this.keycapRenderer }, args);");
  });

  it("is bound over Theia's Electron factory, and nothing patches Lumino's default renderer", () => {
    const module = read("../spexr-frontend-module.ts");
    expect(module).toMatch(/if \(isBound\(ElectronMainMenuFactory\)\) \{\s*rebind\(ElectronMainMenuFactory\)\.to\(SpexrElectronMainMenuFactory\)\.inSingletonScope\(\);\s*\} else \{\s*console\.warn\(/);
    const theia = readFileSync(createRequire(import.meta.url).resolve("@theia/core/src/electron-browser/menu/electron-menu-module.ts"), "utf8");
    expect(theia).toContain("bind(BrowserMainMenuFactory).toService(ElectronMainMenuFactory);");
    expect(`${module}${factory}${read("./menu-keycaps.ts")}`).not.toMatch(/defaultRenderer/);
  });
});
