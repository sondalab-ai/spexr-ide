import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
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
    expect(px(foot, "padding-bottom")).toBe(WORKBENCH.activityBottom);
  });

  it("is the table's strips: 36px tab rows with 28px tiles, 32px breadcrumbs", () => {
    const strips = rule(":root {\n  --theia-private-horizontal-tab-height");
    expect(px(strips, "--theia-private-horizontal-tab-height")).toBe(WORKBENCH.tabStrip);
    expect(px(strips, "--theia-breadcrumbs-height")).toBe(WORKBENCH.breadcrumbs);
    const tab = rule(`${NOT_HC} :is(#theia-main-content-panel, #theia-bottom-content-panel) .lm-TabBar .lm-TabBar-tab {`);
    expect(px(tab, "height")).toBe(WORKBENCH.tab);
    expect(tab).toContain(`margin-top: round(down, calc((var(--theia-horizontal-toolbar-height) - ${WORKBENCH.tab}px) / 2), 1px);`);
    expect(tab).toContain(`margin-bottom: round(up, calc((var(--theia-horizontal-toolbar-height) - ${WORKBENCH.tab}px) / 2), 1px);`);
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

  it("insets a file tree's tiles 8px from the island's outer edge, Lumen's rows, the hover's and the focus ring's too", () => {
    // The island's ring is its padding; offsets from its outer edge take it off.
    expect(rule(":root {\n  --spexr-island-ring")).toMatch(/--spexr-island-ring:\s*1px;/);
    expect(rule(".spexr-island.sl-pane.lm-Widget {")).toMatch(/padding:\s*var\(--spexr-island-ring\);/);
    const INSET = /inset:\s*1px calc\(8px - var\(--spexr-island-ring\)\);/;
    expect(rule(`${NOT_HC} .theia-FileTree .theia-TreeNode.theia-mod-selected::before {`)).toMatch(INSET);
    const hover = rule(`${NOT_HC} .theia-FileTree .theia-TreeNode:hover:not(.theia-mod-selected)::before {`);
    expect(hover).toMatch(INSET);
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
    // A focused row that is not selected: the kit's flush ring on the inset tile, not Theia's outline on the row.
    const FOCUS = `${NOT_HC} .theia-FileTree:focus-within .theia-TreeNode.theia-mod-focus:not(.theia-mod-selected)`;
    expect(rule(`${FOCUS} {`)).toMatch(/outline:\s*0;/);
    const ring = rule(`${FOCUS}::before {`);
    expect(ring).toMatch(INSET);
    expect(ring).toMatch(/outline:\s*var\(--sl-focus-ring-width\) solid var\(--slc-focus\);/);
    expect(ring).toMatch(/outline-offset:\s*calc\(-1 \* var\(--sl-focus-ring-width\)\);/);
    // Theia's own outline on the row, which the rule above outweighs: (0,7,0) against (0,4,0) and (0,5,0).
    const tree = readFileSync(resolve("@theia/core/src/browser/style/tree.css"), "utf8");
    expect(tree).toMatch(/\.theia-Tree:focus-within \.theia-TreeNode\.theia-mod-focus,\s*\.theia-Tree\s*\.ReactVirtualized__List:focus-within\s*\.theia-TreeNode\.theia-mod-focus \{\s*outline-width: 1px;/);
  });

  it("is the table's pane head and toast offset", () => {
    expect(px(rule("#theia-app-shell .theia-sidepanel-toolbar {"), "min-height")).toBe(WORKBENCH.paneHead);
    const title = rule("#theia-app-shell .theia-sidepanel-toolbar .theia-sidepanel-title {");
    expect(title).toMatch(/text-transform:\s*none/);
    expect(title).toMatch(/font-weight:\s*600/);
    expect(title).toMatch(/font-size:\s*0\.8125rem/);
    // 16px from the island's outer edge, inside its ring.
    expect(title).toMatch(/margin-left:\s*calc\(16px - var\(--spexr-island-ring\)\);/);
    expect(px(rule("body .theia-notifications-container {"), "bottom")).toBe(WORKBENCH.toastOffset);
  });
});

// Theia's vertical tabs carry a 2px transparent top and bottom border, the
// drag-over indicator, at !important. It stays; the tile's seam and badge are
// placed in the padding box, 2px down, so both take it back.
describe("the activity tile against Theia's drag-over border", () => {
  it("is still Theia's border, which spexr keeps", () => {
    const tabs = readFileSync(resolve("@theia/core/src/browser/style/tabs.css"), "utf8");
    expect(tabs).toMatch(/--theia-dragover-tab-border-width:\s*2px;/);
    expect(tabs).toMatch(
      /\.lm-TabBar\[data-orientation="vertical"\] \.lm-TabBar-tab \{\s*border-top: var\(--theia-dragover-tab-border-width\) solid transparent !important;\s*border-bottom: var\(--theia-dragover-tab-border-width\) solid transparent !important;/,
    );
  });

  it("puts the count badge 4px from the tile's top, past the border", () => {
    const badge = rule(`${NOT_HC} .lm-TabBar.theia-app-sides .theia-badge-decorator-sidebar {`);
    expect(badge).toMatch(/top:\s*calc\(4px - var\(--theia-dragover-tab-border-width\)\);/);
    expect(badge).toMatch(/right:\s*4px;/);
  });

  it("keeps the current tile's seam half the tile's height", () => {
    const current = rule(`${NOT_HC} .lm-TabBar.theia-app-sides .lm-TabBar-tab.lm-mod-current {`);
    expect(current).toMatch(/background-size:\s*2px calc\(50% \+ var\(--theia-dragover-tab-border-width\)\);/);
    expect(current).toMatch(/background-position:\s*3px 50%;/);
  });

  // High contrast keeps Theia's tab: the 36px tile and its seam are light and
  // dark only, so an HC tab is Theia's icon box (the bar's 52px) and its
  // 2px borders, on the same 8px gap and 4px top as every theme.
  it("leaves high contrast Theia's own tab, on the shared gap", () => {
    expect(css).not.toMatch(/\n:root\[data-sl-theme="high-contrast"\][^{]*theia-app-sides \.lm-TabBar-tab[^{]*\{/);
    const side = readFileSync(resolve("@theia/core/src/browser/style/sidepanel.css"), "utf8");
    expect(side).toMatch(/\.lm-TabBar\.theia-app-sides \.lm-TabBar-tabIcon \{[^}]*width: var\(--theia-private-sidebar-tab-width\);\s*height: var\(--theia-private-sidebar-tab-width\);/);
    expect(rule("#theia-app-shell .lm-TabBar.theia-app-sides .lm-TabBar-content {")).not.toContain("high-contrast");
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
    expect(chrome).toContain(`--theia-private-sidebar-tab-width: ${WORKBENCH.activityBar}px;`);
    expect(chrome).toContain(`--theia-private-horizontal-tab-height: ${WORKBENCH.tabStrip}px;`);
    expect(dock).toContain(`--theia-statusBar-height: ${WORKBENCH.statusBar}px;`);
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
    // The installed method, run with a given leftPadding (Theia's is 8) and indent.
    const body = /getDepthPadding\(depth\) \{([\s\S]*?)\n    \}/.exec(installed)![1]!;
    const run = (leftPadding: number, indent: number, depth: number): number =>
      (new Function("depth", body.replace(/this\.props\.leftPadding/g, String(leftPadding)).replace(/this\.treeIndent/g, String(indent))) as (d: number) => number)(depth);
    const at = (indent: number, depth: number): number => run(8, indent, depth);
    // A tree with its own leftPadding: depth 1 still sits at it, and every level below steps one indent.
    expect([0, 1, 2, 3].map((d) => run(12, 16, d))).toEqual([0, 12, 28, 44]);
    expect([0, 1, 2, 3, 4].map((d) => at(16, d))).toEqual([0, 8, 24, 40, 56]);
    // Theia's defaults (indent 8, leftPadding 8): depth * 8, as before the patch.
    expect([0, 1, 2, 3, 4].map((d) => at(8, d))).toEqual([0, 8, 16, 24, 32]);
  });
});

// spexr's patch to Theia's view container (patches/@theia__core@1.75.0.patch)
// lays each section of a side view (the Explorer's Search, Open Editors,
// folder…) out on whole pixels: weighted sizes put a section half a pixel
// down, which blurred the 1px ring of every tree row's tile inside it.
describe("the view container's whole-pixel patch", () => {
  const patch = repo("patches/@theia__core@1.75.0.patch");
  const installed = readFileSync(resolve("@theia/core/lib/browser/view-container.js"), "utf8");
  const lumino = readFileSync(resolve("@lumino/widgets/dist/index.js", { paths: [dirname(resolve("@theia/core/package.json"))] }), "utf8");

  it("overrides Lumino's per-item placement, which SplitLayout calls for every section", () => {
    expect(patch).toContain("diff --git a/lib/browser/view-container.js b/lib/browser/view-container.js");
    expect(installed).toMatch(/class ViewContainerLayout extends widgets_1\.SplitLayout \{[\s\S]*?\n    updateItemPosition\(i, isHorizontal, left, top, height, width, size\) \{/);
    expect(lumino).toMatch(/this\.updateItemPosition\(i, horz, horz \? left \+ offset : left, horz \? top : top \+ offset, height, width, size\);/);
  });

  it("rounds both edges, so neighbouring sections and their handles still meet", () => {
    const body = /\n    updateItemPosition\(i, isHorizontal, left, top, height, width, size\) \{([\s\S]*?)\n    \}/.exec(installed)![1]!;
    const place = new Function("record", "i", "isHorizontal", "left", "top", "height", "width", "size", body.replace("super.updateItemPosition(", "record(")) as (
      record: (...args: number[]) => void,
      ...args: [number, boolean, number, number, number, number, number]
    ) => void;
    const placed: number[][] = [];
    const record = (...args: number[]): void => void placed.push(args);
    // Three vertical sections from fractional weights, 2px handles between them.
    let top = 0;
    for (const [i, size] of [140.5, 281.25, 96.25].entries()) {
      place(record, i, false, 0, top, 0, 262, size);
      top += size + 2;
    }
    const tops = placed.map((p) => p[3]!);
    const sizes = placed.map((p) => p[6]!);
    expect(tops.every(Number.isInteger) && sizes.every(Number.isInteger)).toBe(true);
    // Each section ends where the next one's handle starts.
    for (let k = 0; k + 1 < placed.length; k++) expect(tops[k]! + sizes[k]! + 2).toBe(tops[k + 1]!);
  });
});
