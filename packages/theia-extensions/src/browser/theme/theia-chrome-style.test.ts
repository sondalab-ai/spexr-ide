import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${NOT_HC} ${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

// Theia's chrome in Lumen (kit 0.31 / 0.32), light and dark only.
describe("Theia's tree selection", () => {
  it("draws the tile as a layer under the row, not as the row's own fill or outline", () => {
    const row = rule(".theia-Tree .theia-TreeNode.theia-mod-selected,");
    expect(row).toMatch(/background:\s*transparent/);
    expect(row).toMatch(/outline:\s*0/);
    const tile = rule(".theia-Tree .theia-TreeNode.theia-mod-selected::before");
    expect(tile).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(tile).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
  });

  it("lifts the tile and adds the seam in the focused tree", () => {
    const focused = rule(".theia-Tree:focus-within .theia-TreeNode.theia-mod-selected::before");
    expect(focused).toMatch(/box-shadow:\s*var\(--slc-depth-tile\)/);
    expect(focused).toMatch(/linear-gradient\(var\(--slc-seam\), var\(--slc-seam\)\)/);
  });
});

describe("Theia's keycaps", () => {
  it("override Monaco's inline key paint with the kit's key", () => {
    const key = rule(".monaco-keybinding > .monaco-keybinding-key");
    expect(key).toMatch(/border:\s*0 !important/);
    expect(key).toMatch(/background-color:\s*var\(--slc-raised\) !important/);
    expect(key).toMatch(/box-shadow:\s*var\(--slc-depth-key\) !important/);
  });
});

describe("the editor's tabs", () => {
  it("raise the current tab as a flat tile with no border of its own", () => {
    const current = rule("#theia-main-content-panel .lm-TabBar .lm-TabBar-tab.lm-mod-current,");
    expect(current).toMatch(/border:\s*0/);
    expect(current).toMatch(/background-color:\s*var\(--slc-tile\)/);
    expect(current).toMatch(/box-shadow:\s*var\(--slc-depth-flat\)/);
  });

  it("leave the other tabs on the canvas, in the muted ink, with no rules between them", () => {
    const tab = rule("#theia-main-content-panel .lm-TabBar .lm-TabBar-tab {");
    expect(tab).toMatch(/border:\s*0/);
    expect(tab).toMatch(/background:\s*transparent/);
    expect(tab).toMatch(/color:\s*var\(--slc-text-muted\)/);
  });
});
