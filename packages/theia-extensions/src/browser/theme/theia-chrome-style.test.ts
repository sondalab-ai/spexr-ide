import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';
const SEAM = /background-image:\s*linear-gradient\(var\(--spexr-seam-ink\), var\(--spexr-seam-ink\)\)/;

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${NOT_HC} ${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

// Theia's chrome in Lumen (kit 0.31 / 0.32), light and dark only. A tile
// alone is found at ~1.3:1 (its ring, since the kit's 0.35 hairlines), so
// every selected or current tile carries the seam: the accent where its
// container has focus, muted elsewhere.
describe("the seam's ink", () => {
  it("is muted by default and the accent where the container has focus", () => {
    expect(rule(":is(.theia-Tree, .quick-input-widget, .scm-history-graph-container) {")).toMatch(/--spexr-seam-ink:\s*var\(--slc-text-muted\)/);
    expect(rule(":is(.theia-Tree, .quick-input-widget, .scm-history-graph-container):focus-within")).toMatch(/--spexr-seam-ink:\s*var\(--slc-seam\)/);
    expect(rule("#theia-main-content-panel .lm-TabBar {")).toMatch(/--spexr-seam-ink:\s*var\(--slc-text-muted\)/);
    expect(rule("#theia-main-content-panel.spexr-island[data-lit] .lm-TabBar.theia-tabBar-active")).toMatch(/--spexr-seam-ink:\s*var\(--slc-seam\)/);
  });
});

describe("Theia's tree selection", () => {
  it("draws the tile as a layer under the row, not as the row's own fill or outline", () => {
    const row = rule(".theia-Tree .theia-TreeNode.theia-mod-selected,");
    expect(row).toMatch(/background:\s*transparent/);
    expect(row).toMatch(/outline:\s*0/);
    const tile = rule(".theia-Tree .theia-TreeNode.theia-mod-selected::before");
    expect(tile).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(tile).toMatch(SEAM);
    expect(tile).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
  });

  it("lifts the tile in the focused tree", () => {
    expect(rule(".theia-Tree:focus-within .theia-TreeNode.theia-mod-selected::before")).toMatch(/box-shadow:\s*var\(--slc-depth-tile\)/);
  });

  it("keeps the indent guides over the tile", () => {
    expect(rule(".theia-tree-node-indent")).toMatch(/z-index:\s*1/);
  });
});

describe("the palette's, a dropdown's and the SCM history's selection", () => {
  it("is a tile with the seam and a ring drawn inside", () => {
    const tile = rule(":is(.quick-input-list .monaco-list-row.focused, .theia-select-component-dropdown .theia-select-component-option.selected, .scm-history-graph-row.selected, .scm-history-change-row.selected) {");
    expect(tile).toMatch(SEAM);
    expect(tile).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--slc-border\);/);
  });
});

// Monaco's suggest widget and code-action menu read Monaco's own colour
// variables (declared on .monaco-editor / .monaco-component), which resolved
// to a white label on #e8e8e8 on light: their focused rows are painted here.
describe("Monaco's lists", () => {
  it.each([
    [".monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused {", false],
    [".action-widget .monaco-list .monaco-list-row.action.focused:not(.option-disabled) {", true],
  ])("paint %s as a tile with the accent seam", (selector, important) => {
    const row = rule(selector as string);
    expect(row).toMatch(/color:\s*var\(--slc-text\);/);
    // !important only where Monaco's own fill is (the code-action row).
    expect(row).toMatch(important ? /background-color:\s*var\(--slc-tile\) !important;/ : /background-color:\s*var\(--slc-tile\);/);
    expect(row).toMatch(/background-image:\s*linear-gradient\(var\(--slc-seam\), var\(--slc-seam\)\)/);
    expect(row).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--slc-border\);/);
  });
});

describe("Theia's keycaps", () => {
  it("override Monaco's inline key paint in the palette and the code-action menu only", () => {
    const key = rule(":is(.quick-input-list, .action-widget .monaco-list-row) .monaco-keybinding > .monaco-keybinding-key");
    expect(key).toMatch(/border:\s*0 !important/);
    expect(key).toMatch(/background-color:\s*var\(--slc-raised\) !important/);
    expect(key).toMatch(/box-shadow:\s*var\(--slc-depth-key\) !important/);
    expect(css).not.toContain(`\n${NOT_HC} .monaco-keybinding > .monaco-keybinding-key`);
  });

  it("give a browser menu's shortcut a box of its own width", () => {
    expect(rule(".lm-Menu .lm-Menu-item {")).toMatch(/display:\s*flex/);
    expect(rule(".lm-Menu :is(.lm-Menu-itemIcon, .lm-Menu-itemShortcut, .lm-Menu-itemSubmenuIcon)")).toMatch(/flex:\s*none/);
  });

  // shell/menu-keycaps.ts draws a menu's shortcut as one .sl-kbd per key; a
  // shortcut that arrives as text keeps S2's one cap behind it.
  it("draw a browser menu's shortcut as one 18px cap per key, the separators out of sight", () => {
    expect(rule(".lm-Menu-itemShortcut:not(:empty):not(:has(> .sl-kbd))::before")).toMatch(/box-shadow:\s*var\(--slc-depth-key\)/);
    expect(css).not.toContain(`\n${NOT_HC} .lm-Menu-itemShortcut:not(:empty)::before`);
    const block = (selector: string): string => {
      const start = css.indexOf(`\n${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(css.indexOf("{", start), css.indexOf("}", start));
    };
    const cap = block(".lm-Menu-itemShortcut > .sl-kbd");
    expect(cap).toMatch(/height:\s*18px/);
    expect(cap).toMatch(/min-width:\s*18px/);
    expect(block(".lm-Menu-itemShortcut > .sl-kbd + .spexr-key-sep + .sl-kbd")).toMatch(/margin-inline-start:\s*3px/);
    expect(block(".lm-Menu-itemShortcut > .sl-kbd + .spexr-key-sep.spexr-key-sep--chord + .sl-kbd")).toMatch(/margin-inline-start:\s*6px/);
    const sep = block(".lm-Menu-itemShortcut > .spexr-key-sep");
    expect(sep).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(sep).not.toMatch(/display:\s*none/);
  });
});

describe("the editor's tabs", () => {
  it("raise the current tab as a flat tile with the seam and no border of its own", () => {
    const current = rule(":is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab.lm-mod-current,");
    expect(current).toMatch(/border:\s*0/);
    expect(current).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(current).toMatch(SEAM);
    expect(current).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
  });

  it("leave the other tabs on the canvas, in the muted ink, with no rules between them", () => {
    const tab = rule(":is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab {");
    expect(tab).toMatch(/border:\s*0/);
    expect(tab).toMatch(/background:\s*transparent/);
    expect(tab).toMatch(/color:\s*var\(--slc-text-muted\)/);
  });

  it("step the current tab's label down in a group without focus", () => {
    // Its own rule, after the shared current-tab rule (which lists the same selector).
    expect(css).toMatch(/\n:root:not\(\[data-sl-theme="high-contrast"\]\) :is\(#theia-main-content-panel, #theia-bottom-content-panel\) \.lm-TabBar:not\(\.theia-tabBar-active\) \.lm-TabBar-tab\.lm-mod-current \{\s*color:\s*var\(--slc-text-secondary\);\s*\}/);
  });

  it("drop the modified-tab band inside the tile", () => {
    const dirty = rule("body.theia-editor-highlightModifiedTabs #theia-main-content-panel .lm-TabBar .lm-TabBar-tab.theia-mod-dirty.theia-mod-dirty");
    expect(dirty).toMatch(/border-top:\s*0/);
  });
});

// Forced colours drop the fills, gradients and shadows the tiles are made of.
describe("forced colours", () => {
  it("outline the selected rows and the current tab in Highlight", () => {
    const block = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(block).toMatch(/\.theia-TreeNode\.theia-mod-selected[\s\S]*?outline:\s*1px solid Highlight/);
    expect(block).toMatch(/\.suggest-widget \.monaco-list \.monaco-list-row\.focused[\s\S]*?outline:\s*1px solid Highlight/);
    expect(block).toMatch(/\.lm-TabBar-tab\.lm-mod-current[\s\S]*?outline:\s*2px solid Highlight/);
  });
});
