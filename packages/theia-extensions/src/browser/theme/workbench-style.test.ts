import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORKBENCH } from "../shell/workbench-geometry.js";

const resolve = createRequire(import.meta.url).resolve;
const css = readFileSync(fileURLToPath(new URL("../style/spexr.css", import.meta.url)), "utf8");
const repo = (file: string): string => readFileSync(fileURLToPath(new URL(`../../../../../${file}`, import.meta.url)), "utf8");
const NOT_HC = ':root:not([data-sl-theme="high-contrast"])';

/** The declarations of the rule whose selector list starts with `selector` (on a line of its own). */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector}`);
  expect(start, `${selector} not found in spexr.css`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
}

/** A length in the rule, as px: `name: 28px` or `name: 1.25rem` (16px to the rem, the kit's). */
function px(block: string, name: string): number {
  const m = new RegExp(`(?:^|[\\s;{])${name}:\\s*([\\d.]+)(px|rem)`).exec(block);
  expect(m, `${name} in ${block.slice(0, 120)}`).not.toBeNull();
  return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
}

/** A section of spexr.css from one heading to the next, comments stripped. */
function section(from: string, to: string): string {
  const start = css.indexOf(from);
  const end = css.indexOf(to, start);
  expect(start, from).toBeGreaterThanOrEqual(0);
  expect(end, to).toBeGreaterThan(start);
  return css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
}

// spexr.css repeats the geometry table (shell/workbench-geometry.ts): CSS
// cannot read it. These hold the two together, value by value.
describe("the shell's geometry in spexr.css", () => {
  it("is the table's frame: a 44px title bar and a 28px status bar", () => {
    expect(px(rule(":root {\n  --theia-private-menubar-height"), "--theia-private-menubar-height")).toBe(WORKBENCH.titleBar);
    expect(px(rule(":root {\n  --theia-statusBar-height"), "--theia-statusBar-height")).toBe(WORKBENCH.statusBar);
    expect(px(rule("#theia-statusBar .area:is(.left, .right) > .element {"), "height")).toBe(WORKBENCH.statusItem);
  });

  it("is the table's activity bar: a 52px column of 36px tiles, 8px apart, the first 4px down", () => {
    expect(px(rule(":root {\n  --theia-private-sidebar-tab-width"), "--theia-private-sidebar-tab-width")).toBe(WORKBENCH.activityBar);
    expect(px(rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tab {`), "width")).toBe(WORKBENCH.activityItem);
    expect(px(rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tabIcon {`), "height")).toBe(WORKBENCH.activityItem);
    const content = rule("#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-content {");
    expect(px(content, "row-gap")).toBe(WORKBENCH.activityGap);
    expect(px(content, "padding-top")).toBe(WORKBENCH.activityTop);
    // The bar's foot (settings, accounts) is the same tiles, 8px apart, 8px off the bottom.
    expect(px(rule(`${NOT_HC} .theia-app-sidebar-container .theia-sidebar-menu-item {`), "height")).toBe(WORKBENCH.activityItem);
    const foot = rule("#theia-app-shell .theia-app-sidebar-container > .theia-sidebar-menu:last-child {");
    expect(px(foot, "gap")).toBe(WORKBENCH.activityGap);
    expect(px(foot, "padding-bottom")).toBe(8);
  });

  it("is the table's strips: 36px tab rows with 28px tiles, 32px breadcrumbs", () => {
    const strips = rule(":root {\n  --theia-private-horizontal-tab-height");
    expect(px(strips, "--theia-private-horizontal-tab-height")).toBe(WORKBENCH.tabStrip);
    expect(px(strips, "--theia-breadcrumbs-height")).toBe(WORKBENCH.breadcrumbs);
    const tab = rule(`${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab {`);
    expect(px(tab, "height")).toBe(WORKBENCH.tab);
    expect(tab).toMatch(/margin-top:\s*round\(down, calc\(\(var\(--theia-horizontal-toolbar-height\) - 28px\) \/ 2\), 1px\)/);
    // Theia's toolbar height is its tab height (tabs.css): the strip variable reaches every horizontal strip.
    const tabs = readFileSync(resolve("@theia/core/src/browser/style/tabs.css"), "utf8");
    expect(tabs).toMatch(/--theia-horizontal-toolbar-height:\s*var\(--theia-private-horizontal-tab-height\)/);
    expect(tabs).toMatch(/min-height:\s*calc\(var\(--theia-breadcrumbs-height\) \+ var\(--theia-horizontal-toolbar-height\)\)/);
  });

  it("is the table's tile tab: the editor's r7 at 13px 500, 12px in", () => {
    const tab = rule(`${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab {`);
    expect(tab).toMatch(/border-radius:\s*7px/);
    expect(tab).toMatch(/font-size:\s*0\.8125rem/);
    expect(tab).toMatch(/font-weight:\s*500/);
    expect(px(tab, "padding-inline")).toBe(12);
    const crumbs = rule("#theia-main-content-panel .theia-breadcrumbs {");
    expect(px(crumbs, "padding-inline")).toBe(16);
    expect(crumbs).toMatch(/font-size:\s*var\(--sl-text-xs\)/);
  });

  it("is the table's tree: 24px rows in a file tree, 16px a level", () => {
    expect(px(rule(".theia-FileTree {"), "--theia-content-line-height")).toBe(WORKBENCH.treeRow);
    // Theia sizes a tree row and its indent guides from that variable.
    const tree = readFileSync(resolve("@theia/core/src/browser/style/tree.css"), "utf8");
    expect(tree).toMatch(/\.theia-TreeNode \{\s*line-height:\s*var\(--theia-content-line-height\);/);
    expect(tree).toMatch(/\.theia-tree-node-indent \{\s*position: absolute;\s*height:\s*var\(--theia-content-line-height\);/);
    const prefs = JSON.parse(repo("apps/desktop/package.json")) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
    expect(prefs.theia.frontend.config.preferences["workbench.tree.indent"]).toBe(WORKBENCH.treeIndent);
    // A twisty of 2 + 16 + 2 and a 2px margin: Theia's 22px leaf padding, so leaves line up with folders.
    expect(rule(".theia-Tree .theia-ExpansionToggle {")).toMatch(/margin-inline-end:\s*2px/);
    const toggle = readFileSync(resolve("@theia/core/src/browser/style/tree.css"), "utf8");
    expect(toggle).toMatch(/\.theia-ExpansionToggle \{[^}]*padding-left: calc\(var\(--theia-ui-padding\) \/ 3\);\s*padding-right: calc\(var\(--theia-ui-padding\) \/ 3\);\s*min-width: var\(--theia-icon-size\);/);
    expect(readFileSync(resolve("@theia/core/lib/browser/tree/tree-widget.js"), "utf8")).toMatch(/leftPadding: 8,\s*expansionTogglePadding: 22/);
  });

  it("insets a file tree's tiles 8px from the island's edges, Lumen's rows, the hover's too", () => {
    expect(rule(`${NOT_HC} .theia-FileTree .theia-TreeNode.theia-mod-selected::before {`)).toMatch(/inset:\s*1px 7px;/);
    const hover = rule(`${NOT_HC} .theia-FileTree .theia-TreeNode:hover:not(.theia-mod-selected)::before {`);
    expect(hover).toMatch(/inset:\s*1px 7px;/);
    expect(hover).toMatch(/z-index:\s*-1;/);
    expect(hover).toMatch(/background-color:\s*color-mix\(in srgb, var\(--slc-text\) 5%, transparent\);/);
    expect(rule(`${NOT_HC} .theia-FileTree .theia-TreeNode:hover {`)).toMatch(/background:\s*transparent;/);
    // The tile is a layer under the row: the row is its positioned, isolated host.
    const row = rule(`${NOT_HC} .theia-FileTree .theia-TreeNode {`);
    expect(row).toMatch(/position:\s*relative;/);
    expect(row).toMatch(/isolation:\s*isolate;/);
    // It follows the shared tile rule, which it outweighs only by order.
    expect(css.indexOf(`\n${NOT_HC} .theia-FileTree .theia-TreeNode.theia-mod-selected::before {`)).toBeGreaterThan(
      css.indexOf(`\n${NOT_HC} .theia-Tree .theia-TreeNode.theia-mod-selected::before {`),
    );
  });

  it("is the table's pane head and toast offset", () => {
    expect(px(rule("#theia-app-shell .theia-sidepanel-toolbar {"), "min-height")).toBe(WORKBENCH.paneHead);
    const title = rule("#theia-app-shell .theia-sidepanel-toolbar .theia-sidepanel-title {");
    expect(title).toMatch(/text-transform:\s*none/);
    expect(title).toMatch(/font-weight:\s*600/);
    expect(title).toMatch(/font-size:\s*0\.8125rem/);
    expect(px(rule("body .theia-notifications-container {"), "bottom")).toBe(WORKBENCH.toastOffset);
  });
});

// workbench-geometry.ts's areaSize counts the gap between an activity bar and
// its island inside the side's size: the column carries it as padding on
// the island's side, and drops it when the side is collapsed.
describe("the activity column", () => {
  const SIDES = "#theia-app-shell.spexr-islands :is(#theia-left-content-panel, #theia-right-content-panel)";

  it("is the bar and the island gap, padded on the island's side", () => {
    const column = rule(`${SIDES} > .theia-app-sidebar-container {`);
    expect(column).toMatch(/min-width:\s*calc\(var\(--theia-private-sidebar-tab-width\) \+ var\(--spexr-island-gap\)\);/);
    expect(column).toMatch(/max-width:\s*calc\(var\(--theia-private-sidebar-tab-width\) \+ var\(--spexr-island-gap\)\);/);
    expect(rule("#theia-app-shell.spexr-islands #theia-left-content-panel > .theia-app-sidebar-container {")).toMatch(/padding-right:\s*var\(--spexr-island-gap\);/);
    expect(rule("#theia-app-shell.spexr-islands #theia-right-content-panel > .theia-app-sidebar-container {")).toMatch(/padding-left:\s*var\(--spexr-island-gap\);/);
  });

  it("is the bar alone on a collapsed side, as wide as Theia lets a collapsed side be", () => {
    const collapsed = rule(`${SIDES}.theia-mod-collapsed > .theia-app-sidebar-container {`);
    expect(collapsed).toMatch(/min-width:\s*var\(--theia-private-sidebar-tab-width\);/);
    expect(collapsed).toMatch(/max-width:\s*var\(--theia-private-sidebar-tab-width\);/);
    expect(collapsed).toMatch(/padding-inline:\s*0;/);
    const side = readFileSync(resolve("@theia/core/src/browser/style/sidepanel.css"), "utf8");
    expect(side).toMatch(/#theia-right-content-panel\.theia-mod-collapsed \{\s*max-width: var\(--theia-private-sidebar-tab-width\);/);
    expect(side).toMatch(/\.theia-app-sidebar-container \{\s*min-width: var\(--theia-private-sidebar-tab-width\);\s*max-width: var\(--theia-private-sidebar-tab-width\);/);
  });

  it("is layout in every theme, not only light and dark", () => {
    for (const s of [
      `${SIDES} > .theia-app-sidebar-container {`,
      `${SIDES}.theia-mod-collapsed > .theia-app-sidebar-container {`,
      "#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-content {",
      ".theia-FileTree {",
      "#theia-app-shell .theia-sidepanel-toolbar {",
      "body .theia-notifications-container {",
    ]) {
      expect(css, s).toContain(`\n${s}`);
    }
  });
});

// The theme layer holds the colours; the geometry adds none.
describe("the S5c rules", () => {
  const chrome = section("/* ══ THEIA'S CHROME IN LUMEN", "/* ══ THE TITLE BAR");
  const dock = section("/* ══ THE STATUS DOCK", "/* ══ TOASTS AND THE NOTIFICATION CENTER");

  it("are found, so the checks below are not vacuous", () => {
    expect(chrome).toContain(".theia-FileTree {");
    expect(chrome).toContain("--theia-private-sidebar-tab-width: 52px;");
    expect(chrome).toContain("--theia-private-horizontal-tab-height: 36px;");
    expect(dock).toContain("--theia-statusBar-height: 28px;");
  });

  it("write no colour literal", () => {
    for (const text of [chrome, dock]) {
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch)\(/);
      expect(text).not.toMatch(/:\s*(white|black|red|gray|grey|blue|green)\b/);
    }
  });
});

// spexr's patch to Theia's tree (patches/@theia__core@1.75.0.patch) makes
// every level below the first one indent: Theia's depth * indent stepped from
// depth 1 to 2 by twice it once the indent was not its leftPadding.
describe("the tree indent patch", () => {
  const patch = repo("patches/@theia__core@1.75.0.patch");
  const installed = readFileSync(resolve("@theia/core/lib/browser/tree/tree-widget.js"), "utf8");

  it("replaces Theia's depth * indent below depth 1, and keeps depth 1 at leftPadding", () => {
    expect(patch).toContain("-        return depth * this.treeIndent;");
    expect(patch).toContain("+        return depth > 1 ? this.props.leftPadding + (depth - 1) * this.treeIndent : depth * this.treeIndent;");
    expect(installed).toMatch(/getDepthPadding\(depth\) \{\s*if \(depth === 1\) \{\s*return this\.props\.leftPadding;\s*\}/);
    expect(installed).toContain("return depth > 1 ? this.props.leftPadding + (depth - 1) * this.treeIndent : depth * this.treeIndent;");
  });

  it("steps every level by the indent, and changes nothing at Theia's defaults", () => {
    // The installed method, run with Theia's leftPadding (8) and a given indent.
    const body = /getDepthPadding\(depth\) \{([\s\S]*?)\n    \}/.exec(installed)![1]!;
    const at = (indent: number, depth: number): number =>
      (new Function("depth", body.replace(/this\.props\.leftPadding/g, "8").replace(/this\.treeIndent/g, String(indent))) as (d: number) => number)(depth);
    expect([0, 1, 2, 3, 4].map((d) => at(16, d))).toEqual([0, 8, 24, 40, 56]);
    // Theia's defaults (indent 8, leftPadding 8): depth * 8, as before the patch.
    expect([0, 1, 2, 3, 4].map((d) => at(8, d))).toEqual([0, 8, 16, 24, 32]);
  });
});
